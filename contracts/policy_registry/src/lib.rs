//! CapFare policy registry.
//!
//! Modules: premium engine (public formula from `capfare-core`, parameters with a
//! timelock), policies and quotes, claims/settlement with nullifiers, payouts via
//! the two vaults, and the user's prepaid credit balance.
//!
//! Every cross-contract step that moves value has a callback that restores state
//! if the step fails (see `purchase.rs`, `claims.rs`, `credit.rs`).

mod claims;
mod credit;
pub mod ext;
mod purchase;
pub mod types;
mod views;

use capfare_core::*;
use near_sdk::json_types::U128;
use near_sdk::serde::de::DeserializeOwned;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};
pub use types::*;

pub(crate) const GAS_VIEW: Gas = Gas::from_tgas(10);
pub(crate) const GAS_ATT_CONSUME: Gas = Gas::from_tgas(25);
pub(crate) const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub(crate) const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(80);
pub(crate) const GAS_VAULT_PAYOUT: Gas = Gas::from_tgas(50);
pub(crate) const GAS_SMALL_CB: Gas = Gas::from_tgas(20);
pub(crate) const GAS_PURCHASE_CB: Gas = Gas::from_tgas(150);
pub(crate) const GAS_CLAIM_CB: Gas = Gas::from_tgas(100);
pub(crate) const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MAX_RESULT_LEN: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
pub(crate) enum Key {
    Policies,
    OwnerPolicies,
    Credit,
    FlightExposure,
    RouteWeekExposure,
    UserFlightCount,
    UserDayCount,
    Active,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PolicyRegistry {
    pub(crate) owner: AccountId,
    pub(crate) token: AccountId,
    pub(crate) attestation: AccountId,
    pub(crate) cap_vault: AccountId,
    pub(crate) drop_vault: AccountId,
    pub(crate) params: Params,
    pub(crate) pending_params: Option<PendingParams>,
    pub(crate) paused: bool,
    pub(crate) next_policy_id: u64,
    pub(crate) policies: LookupMap<u64, Policy>,
    pub(crate) owner_policies: LookupMap<AccountId, Vec<u64>>,
    pub(crate) active: IterableSet<u64>,
    pub(crate) credit: LookupMap<AccountId, u128>,
    pub(crate) credit_total: u128,
    /// Premiums sent to vaults / credit withdrawals waiting for a callback.
    pub(crate) in_flight: u128,
    pub(crate) flight_exposure: LookupMap<(Product, Hash32), u64>,
    pub(crate) route_week_exposure: LookupMap<(Product, Hash32), u64>,
    pub(crate) user_flight_count: LookupMap<(AccountId, Product, Hash32), u32>,
    pub(crate) user_day_count: LookupMap<(AccountId, u64), u32>,
    pub(crate) policies_total: u64,
    pub(crate) active_cap: u64,
    pub(crate) active_drop: u64,
}

pub(crate) fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

pub(crate) fn event(kind: &str, data: serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        json!({"standard": "capfare_policy", "version": "1.0.0", "event": kind, "data": [data]})
    );
}

/// Reads callback result `idx` as JSON. Err(()) if the promise failed.
pub(crate) fn promise_json<T: DeserializeOwned>(idx: u64) -> Result<T, String> {
    match env::promise_result_checked(idx, MAX_RESULT_LEN) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("bad result: {e}")),
        Err(_) => Err("cross-contract call failed".into()),
    }
}

pub(crate) fn promise_ok(idx: u64) -> bool {
    env::promise_result_checked(idx, MAX_RESULT_LEN).is_ok()
}

#[near]
impl PolicyRegistry {
    #[init]
    pub fn new(
        owner: AccountId,
        token: AccountId,
        attestation: AccountId,
        cap_vault: AccountId,
        drop_vault: AccountId,
        params: Params,
    ) -> Self {
        if let Err(e) = params.validate() {
            env::panic_str(e);
        }
        Self {
            owner,
            token,
            attestation,
            cap_vault,
            drop_vault,
            params,
            pending_params: None,
            paused: false,
            next_policy_id: 1,
            policies: LookupMap::new(Key::Policies),
            owner_policies: LookupMap::new(Key::OwnerPolicies),
            active: IterableSet::new(Key::Active),
            credit: LookupMap::new(Key::Credit),
            credit_total: 0,
            in_flight: 0,
            flight_exposure: LookupMap::new(Key::FlightExposure),
            route_week_exposure: LookupMap::new(Key::RouteWeekExposure),
            user_flight_count: LookupMap::new(Key::UserFlightCount),
            user_day_count: LookupMap::new(Key::UserDayCount),
            policies_total: 0,
            active_cap: 0,
            active_drop: 0,
        }
    }

    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    pub(crate) fn vault_for(&self, p: Product) -> AccountId {
        match p {
            Product::Cap => self.cap_vault.clone(),
            Product::Drop => self.drop_vault.clone(),
        }
    }

    // ------------------------------------------------------- timelocked params

    /// Publishes new parameters; they apply after `param_timelock_secs`.
    pub fn propose_params(&mut self, params: Params) {
        self.assert_owner();
        if let Err(e) = params.validate() {
            env::panic_str(e);
        }
        let now = now_secs();
        let apply_after = now + self.params.global.param_timelock_secs;
        event("params_proposed", json!({"apply_after": apply_after, "params": params}));
        self.pending_params = Some(PendingParams { params, apply_after, proposed_at: now });
    }

    /// Anyone can apply published parameters once the timelock has passed.
    pub fn apply_params(&mut self) {
        let p = self.pending_params.take().unwrap_or_else(|| env::panic_str("no pending params"));
        require!(now_secs() >= p.apply_after, "timelock has not passed");
        self.params = p.params;
        event("params_applied", json!({"params": self.params}));
    }

    pub fn cancel_params(&mut self) {
        self.assert_owner();
        require!(self.pending_params.take().is_some(), "no pending params");
        event("params_cancelled", json!({}));
    }

    /// Emergency stop for new sales only. Claims, payouts and refunds keep working.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        event("paused", json!({"paused": paused}));
    }

    // ------------------------------------------------------------ bookkeeping

    pub(crate) fn add_exposure(&mut self, p: &Policy) {
        let k = (p.product, p.flight_key_hash);
        *self.flight_exposure.entry(k).or_insert(0) += p.max_payout_minor;
        let rk = (p.product, p.route_week_key);
        *self.route_week_exposure.entry(rk).or_insert(0) += p.max_payout_minor;
        let uk = (p.owner.clone(), p.product, p.flight_key_hash);
        *self.user_flight_count.entry(uk).or_insert(0) += 1;
        self.active.insert(p.id);
        match p.product {
            Product::Cap => self.active_cap += 1,
            Product::Drop => self.active_drop += 1,
        }
    }

    pub(crate) fn remove_exposure(&mut self, p: &Policy) {
        let k = (p.product, p.flight_key_hash);
        if let Some(v) = self.flight_exposure.get_mut(&k) {
            *v = v.saturating_sub(p.max_payout_minor);
        }
        let rk = (p.product, p.route_week_key);
        if let Some(v) = self.route_week_exposure.get_mut(&rk) {
            *v = v.saturating_sub(p.max_payout_minor);
        }
        let uk = (p.owner.clone(), p.product, p.flight_key_hash);
        if let Some(v) = self.user_flight_count.get_mut(&uk) {
            *v = v.saturating_sub(1);
        }
        if self.active.remove(&p.id) {
            match p.product {
                Product::Cap => self.active_cap -= 1,
                Product::Drop => self.active_drop -= 1,
            }
        }
    }

    pub(crate) fn get_policy_mut_checked(&mut self, id: u64) -> Policy {
        let p = self.policies.get(&id).cloned().unwrap_or_else(|| env::panic_str("unknown policy"));
        require!(!p.busy, "policy has an operation in flight");
        p
    }

    pub(crate) fn save(&mut self, p: Policy) {
        self.policies.insert(p.id, p);
    }

    pub(crate) fn usdc(&self, cents: u64, rate: u64) -> u128 {
        cents_to_usdc_ceil(cents, rate)
    }

    pub(crate) fn credit_of(&self, a: &AccountId) -> u128 {
        self.credit.get(a).copied().unwrap_or(0)
    }

    pub(crate) fn add_credit(&mut self, a: &AccountId, amount: u128) {
        *self.credit.entry(a.clone()).or_insert(0) += amount;
        self.credit_total += amount;
    }

    pub(crate) fn sub_credit(&mut self, a: &AccountId, amount: u128) {
        let bal = self.credit_of(a);
        require!(bal >= amount, "not enough credit; top up first");
        self.credit.insert(a.clone(), bal - amount);
        self.credit_total -= amount;
    }

    #[allow(dead_code)]
    pub(crate) fn usdc_u128(v: U128) -> u128 {
        v.0
    }
}

#[cfg(test)]
mod tests;
