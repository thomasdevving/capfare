//! CapFare LP vault. One instance per product (cap_vault, drop_vault).
//!
//! Accounting (all micro-USDC):
//!   total_assets          LP-owned assets, including locked coverage
//!   locked_coverage       sum of max payouts of active policies
//!   reserved_withdrawals  USDC set aside for queued withdrawals ("pending_withdrawals")
//!   unearned_premiums     premiums of unresolved policies (not LP-owned yet)
//!   fees_accrued          protocol fees not yet sent to the fee account
//!   pending_deposits      queued LP deposits (not LP-owned until the epoch rolls)
//!   claimable_total       processed withdrawals waiting to be claimed
//!   in_flight             transfers sent, callback not yet seen
//!
//! INVARIANT (checked after every state change):
//!   total_assets >= locked_coverage + reserved_withdrawals
//! ACCOUNTING IDENTITY (at quiescent points; checked in tests):
//!   token balance == total_assets + unearned + fees + pending_deposits + claimable + in_flight

use capfare_core::math::{mul_div_ceil, mul_div_floor, BPS};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

/// Virtual offsets (ERC-4626 style) against first-depositor share inflation.
pub const VIRTUAL_ASSETS: u128 = 1_000_000;
pub const VIRTUAL_SHARES: u128 = 1_000_000;
pub const MAX_QUEUE: u32 = 200;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MAX_RESULT_LEN: usize = 1024;

#[ext_contract(ext_ft)]
pub trait FtContract {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn on_payout_transfer(&mut self, policy_id: u64, amount: U128) -> bool;
    fn on_refund_transfer(&mut self, policy_id: u64) -> bool;
    fn on_claim_transfer(&mut self, account_id: AccountId, amount: U128) -> bool;
    fn on_fee_transfer(&mut self, amount: U128) -> bool;
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Shares,
    Claimable,
    DepositQueue,
    WithdrawQueue,
    Positions,
    History,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub lock: U128,
    pub premium: U128,
    pub fee_bps: u32,
    pub busy: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct WithdrawRequest {
    pub account_id: AccountId,
    pub shares: U128,
    pub reserved: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct DepositRequest {
    pub account_id: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EpochRecord {
    pub epoch: u64,
    pub ended_at: u64,
    pub total_assets: U128,
    pub total_shares: U128,
    /// micro-USDC per 1e6 shares, after processing.
    pub share_price_e6: U128,
    pub deposits: U128,
    pub withdrawals: U128,
    pub premiums_earned: U128,
    pub payouts: U128,
    pub locked_coverage: U128,
}

#[near(serializers = [json])]
pub struct VaultState {
    pub name: String,
    pub token: AccountId,
    pub registry: AccountId,
    pub epoch: u64,
    pub epoch_start: u64,
    pub epoch_secs: u64,
    pub next_epoch_at: u64,
    pub total_assets: U128,
    pub total_shares: U128,
    pub locked_coverage: U128,
    pub pending_withdrawals: U128,
    pub unearned_premiums: U128,
    pub fees_accrued: U128,
    pub pending_deposits: U128,
    pub claimable_total: U128,
    pub in_flight: U128,
    pub free_liquidity: U128,
    pub share_price_e6: U128,
    pub active_positions: u64,
    pub premiums_earned_total: U128,
    pub payouts_total: U128,
    pub invariant_ok: bool,
    pub deposit_queue_len: u32,
    pub withdraw_queue_len: u32,
}

#[near(serializers = [json])]
#[derive(Debug)]
#[serde(rename_all = "snake_case")]
pub enum TransferMsg {
    Deposit,
    Policy { policy_id: u64, lock: U128, fee_bps: u32 },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    name: String,
    token: AccountId,
    registry: AccountId,
    fee_account: AccountId,
    epoch_secs: u64,
    epoch: u64,
    epoch_start: u64,
    min_deposit: u128,
    total_assets: u128,
    total_shares: u128,
    locked_coverage: u128,
    reserved_withdrawals: u128,
    unearned_premiums: u128,
    fees_accrued: u128,
    pending_deposits: u128,
    claimable_total: u128,
    in_flight: u128,
    active_positions: u64,
    premiums_earned_total: u128,
    payouts_total: u128,
    epoch_premiums: u128,
    epoch_payouts: u128,
    shares: LookupMap<AccountId, u128>,
    claimable: LookupMap<AccountId, u128>,
    deposit_queue: Vector<DepositRequest>,
    withdraw_queue: Vector<WithdrawRequest>,
    positions: LookupMap<u64, Position>,
    history: Vector<EpochRecord>,
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn event(kind: &str, data: serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        json!({"standard": "capfare_vault", "version": "1.0.0", "event": kind, "data": [data]})
    );
}

#[near]
impl Vault {
    #[init]
    pub fn new(
        owner: AccountId,
        name: String,
        token: AccountId,
        registry: AccountId,
        fee_account: AccountId,
        epoch_secs: u64,
        min_deposit: U128,
    ) -> Self {
        require!(epoch_secs > 0, "epoch_secs must be positive");
        Self {
            owner,
            name,
            token,
            registry,
            fee_account,
            epoch_secs,
            epoch: 0,
            epoch_start: now_secs(),
            min_deposit: min_deposit.0,
            total_assets: 0,
            total_shares: 0,
            locked_coverage: 0,
            reserved_withdrawals: 0,
            unearned_premiums: 0,
            fees_accrued: 0,
            pending_deposits: 0,
            claimable_total: 0,
            in_flight: 0,
            active_positions: 0,
            premiums_earned_total: 0,
            payouts_total: 0,
            epoch_premiums: 0,
            epoch_payouts: 0,
            shares: LookupMap::new(Key::Shares),
            claimable: LookupMap::new(Key::Claimable),
            deposit_queue: Vector::new(Key::DepositQueue),
            withdraw_queue: Vector::new(Key::WithdrawQueue),
            positions: LookupMap::new(Key::Positions),
            history: Vector::new(Key::History),
        }
    }

    // ---------------------------------------------------------------- internals

    fn free_liquidity_raw(&self) -> u128 {
        self.total_assets
            .saturating_sub(self.locked_coverage)
            .saturating_sub(self.reserved_withdrawals)
    }

    fn assert_invariant(&self) {
        require!(
            self.total_assets >= self.locked_coverage + self.reserved_withdrawals,
            "INVARIANT VIOLATED: total_assets < locked_coverage + pending_withdrawals"
        );
    }

    fn value_of_shares_floor(&self, shares: u128) -> u128 {
        mul_div_floor(shares, self.total_assets + VIRTUAL_ASSETS, self.total_shares + VIRTUAL_SHARES)
    }

    fn value_of_shares_ceil(&self, shares: u128) -> u128 {
        mul_div_ceil(shares, self.total_assets + VIRTUAL_ASSETS, self.total_shares + VIRTUAL_SHARES)
    }

    fn shares_for_deposit_floor(&self, amount: u128) -> u128 {
        mul_div_floor(amount, self.total_shares + VIRTUAL_SHARES, self.total_assets + VIRTUAL_ASSETS)
    }

    fn share_price_e6(&self) -> u128 {
        mul_div_floor(1_000_000, self.total_assets + VIRTUAL_ASSETS, self.total_shares + VIRTUAL_SHARES)
    }

    fn assert_registry(&self) {
        require!(env::predecessor_account_id() == self.registry, "only the policy registry");
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    fn callback_ok() -> bool {
        env::promise_results_count() == 1 && env::promise_result_checked(0, MAX_RESULT_LEN).is_ok()
    }

    /// Moves the policy premium (net of fee) into LP assets and releases its lock.
    fn resolve_position(&mut self, policy_id: u64, pos: &Position, earn_premium: bool) {
        self.locked_coverage -= pos.lock.0;
        if earn_premium {
            self.unearned_premiums -= pos.premium.0;
            let fee = mul_div_ceil(pos.premium.0, pos.fee_bps as u128, BPS);
            let earned = pos.premium.0 - fee;
            self.fees_accrued += fee;
            self.total_assets += earned;
            self.premiums_earned_total += earned;
            self.epoch_premiums += earned;
        }
        self.positions.remove(&policy_id);
        self.active_positions -= 1;
    }

    fn take_position(&mut self, policy_id: u64) -> Position {
        let pos = self.positions.get(&policy_id).cloned().unwrap_or_else(|| env::panic_str("unknown policy"));
        require!(!pos.busy, "policy has a transfer in flight");
        pos
    }

    // -------------------------------------------------------------- NEP-141 hook

    /// Entry point for USDC: LP deposits (msg "deposit") and policy premiums from
    /// the registry (msg {"policy": {...}}). Returns the unused amount.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "only the settlement token");
        let parsed: TransferMsg =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("invalid msg"));
        match parsed {
            TransferMsg::Deposit => {
                require!(amount.0 >= self.min_deposit, "deposit below minimum");
                require!(self.deposit_queue.len() < MAX_QUEUE, "deposit queue full; try after the epoch rolls");
                self.pending_deposits += amount.0;
                self.deposit_queue.push(DepositRequest { account_id: sender_id.clone(), amount });
                event("deposit_queued", json!({"account_id": sender_id, "amount": amount, "epoch": self.epoch}));
                PromiseOrValue::Value(U128(0))
            }
            TransferMsg::Policy { policy_id, lock, fee_bps } => {
                require!(sender_id == self.registry, "only the registry sells policies");
                let ok = !self.positions.contains_key(&policy_id)
                    && amount.0 > 0
                    && amount.0 < lock.0
                    && fee_bps <= 5_000
                    && self.free_liquidity_raw() >= lock.0;
                if !ok {
                    event("lock_rejected", json!({"policy_id": policy_id, "lock": lock, "free_liquidity": U128(self.free_liquidity_raw())}));
                    return PromiseOrValue::Value(amount);
                }
                self.locked_coverage += lock.0;
                self.unearned_premiums += amount.0;
                self.active_positions += 1;
                self.positions.insert(policy_id, Position { lock, premium: amount, fee_bps, busy: false });
                self.assert_invariant();
                event("coverage_locked", json!({"policy_id": policy_id, "lock": lock, "premium": amount}));
                PromiseOrValue::Value(U128(0))
            }
        }
    }

    // ------------------------------------------------------------------ LP flow

    /// Queues a withdrawal of `shares`. Their current value (rounded up) is
    /// reserved from free liquidity immediately; USDC is released at the next epoch.
    pub fn request_withdraw(&mut self, shares: U128) {
        let account = env::predecessor_account_id();
        let bal = self.shares.get(&account).copied().unwrap_or(0);
        require!(shares.0 > 0 && shares.0 <= bal, "not enough shares");
        require!(self.withdraw_queue.len() < MAX_QUEUE, "withdraw queue full");
        let reserved = self.value_of_shares_ceil(shares.0).min(self.total_assets);
        require!(
            reserved <= self.free_liquidity_raw(),
            "not enough free liquidity right now; request fewer shares or wait for coverage to expire"
        );
        self.shares.insert(account.clone(), bal - shares.0);
        self.reserved_withdrawals += reserved;
        self.withdraw_queue.push(WithdrawRequest { account_id: account.clone(), shares, reserved: U128(reserved) });
        self.assert_invariant();
        event("withdraw_queued", json!({"account_id": account, "shares": shares, "reserved": U128(reserved), "epoch": self.epoch}));
    }

    /// Processes queued withdrawals then deposits at the epoch share price.
    /// Callable by anyone once the epoch has ended.
    pub fn roll_epoch(&mut self) -> EpochRecord {
        let now = now_secs();
        require!(now >= self.epoch_start + self.epoch_secs, "epoch has not ended");
        let mut withdrawn: u128 = 0;
        // Withdrawals first, at the pre-roll share price.
        let wq: Vec<WithdrawRequest> = self.withdraw_queue.iter().cloned().collect();
        self.withdraw_queue.clear();
        for w in wq {
            let value = self.value_of_shares_floor(w.shares.0);
            // Release the reservation; free liquidity now includes it, and the
            // withdrawal can never take more than that.
            self.reserved_withdrawals -= w.reserved.0;
            let out = value.min(self.free_liquidity_raw());
            self.total_assets -= out;
            self.total_shares -= w.shares.0;
            *self.claimable.entry(w.account_id.clone()).or_insert(0) += out;
            self.claimable_total += out;
            withdrawn += out;
            event("withdraw_processed", json!({"account_id": w.account_id, "shares": w.shares, "amount": U128(out)}));
        }
        // Deposits at the post-withdrawal share price (rounded against the depositor).
        let dq: Vec<DepositRequest> = self.deposit_queue.iter().cloned().collect();
        self.deposit_queue.clear();
        let mut deposited: u128 = 0;
        for d in dq {
            let minted = self.shares_for_deposit_floor(d.amount.0);
            self.pending_deposits -= d.amount.0;
            self.total_assets += d.amount.0;
            self.total_shares += minted;
            *self.shares.entry(d.account_id.clone()).or_insert(0) += minted;
            deposited += d.amount.0;
            event("deposit_processed", json!({"account_id": d.account_id, "amount": d.amount, "shares": U128(minted)}));
        }
        let rec = EpochRecord {
            epoch: self.epoch,
            ended_at: now,
            total_assets: U128(self.total_assets),
            total_shares: U128(self.total_shares),
            share_price_e6: U128(self.share_price_e6()),
            deposits: U128(deposited),
            withdrawals: U128(withdrawn),
            premiums_earned: U128(self.epoch_premiums),
            payouts: U128(self.epoch_payouts),
            locked_coverage: U128(self.locked_coverage),
        };
        self.history.push(rec.clone());
        self.epoch += 1;
        self.epoch_start = now;
        self.epoch_premiums = 0;
        self.epoch_payouts = 0;
        self.assert_invariant();
        event("epoch_rolled", json!(rec));
        rec
    }

    /// Sends processed withdrawals to the caller. Rolls back if the transfer fails.
    pub fn claim_withdrawal(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let amount = self.claimable.get(&account).copied().unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.claimable.insert(account.clone(), 0);
        self.claimable_total -= amount;
        self.in_flight += amount;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), Some("CapFare vault withdrawal".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_claim_transfer(account, U128(amount)))
    }

    #[private]
    pub fn on_claim_transfer(&mut self, account_id: AccountId, amount: U128) -> bool {
        self.in_flight -= amount.0;
        if Self::callback_ok() {
            event("withdrawal_claimed", json!({"account_id": account_id, "amount": amount}));
            true
        } else {
            *self.claimable.entry(account_id.clone()).or_insert(0) += amount.0;
            self.claimable_total += amount.0;
            event("withdrawal_claim_reverted", json!({"account_id": account_id, "amount": amount}));
            false
        }
    }

    // ------------------------------------------------------------ registry flow

    /// Policy expired or voided: release coverage, premium becomes LP income.
    pub fn release(&mut self, policy_id: u64) {
        self.assert_registry();
        let pos = self.take_position(policy_id);
        self.resolve_position(policy_id, &pos, true);
        self.assert_invariant();
        event("coverage_released", json!({"policy_id": policy_id, "lock": pos.lock}));
    }

    /// Pays `amount` (<= lock) to `receiver_id`. The paid part leaves locked
    /// coverage immediately; the rest of the lock stays until the transfer is
    /// confirmed, so a failed transfer can be rolled back without ever touching
    /// free liquidity. Returns true on success via the callback.
    pub fn payout(&mut self, policy_id: u64, receiver_id: AccountId, amount: U128) -> PromiseOrValue<bool> {
        self.assert_registry();
        let mut pos = self.take_position(policy_id);
        require!(amount.0 <= pos.lock.0, "payout exceeds locked coverage");
        if amount.0 == 0 {
            self.resolve_position(policy_id, &pos, true);
            self.assert_invariant();
            event("coverage_released", json!({"policy_id": policy_id, "lock": pos.lock}));
            return PromiseOrValue::Value(true);
        }
        self.total_assets -= amount.0;
        self.locked_coverage -= amount.0;
        self.in_flight += amount.0;
        pos.lock = U128(pos.lock.0 - amount.0);
        pos.busy = true;
        self.positions.insert(policy_id, pos);
        self.assert_invariant();
        PromiseOrValue::Promise(
            ext_ft::ext(self.token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(receiver_id, amount, Some(format!("CapFare payout policy {policy_id}")))
                .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_payout_transfer(policy_id, amount)),
        )
    }

    #[private]
    pub fn on_payout_transfer(&mut self, policy_id: u64, amount: U128) -> bool {
        self.in_flight -= amount.0;
        let mut pos = self.positions.get(&policy_id).cloned().expect("position missing");
        pos.busy = false;
        if Self::callback_ok() {
            self.payouts_total += amount.0;
            self.epoch_payouts += amount.0;
            self.resolve_position(policy_id, &pos, true);
            self.assert_invariant();
            event("payout_sent", json!({"policy_id": policy_id, "amount": amount}));
            true
        } else {
            // Roll back: the paid part returns to assets and to the lock.
            self.total_assets += amount.0;
            self.locked_coverage += amount.0;
            pos.lock = U128(pos.lock.0 + amount.0);
            self.positions.insert(policy_id, pos);
            self.assert_invariant();
            event("payout_reverted", json!({"policy_id": policy_id, "amount": amount}));
            false
        }
    }

    /// Sold-out refund: the full premium goes back to the buyer, coverage released.
    pub fn refund_premium(&mut self, policy_id: u64, receiver_id: AccountId) -> Promise {
        self.assert_registry();
        let mut pos = self.take_position(policy_id);
        self.unearned_premiums -= pos.premium.0;
        self.in_flight += pos.premium.0;
        pos.busy = true;
        let premium = pos.premium;
        self.positions.insert(policy_id, pos);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(receiver_id, premium, Some(format!("CapFare premium refund policy {policy_id}")))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_refund_transfer(policy_id))
    }

    #[private]
    pub fn on_refund_transfer(&mut self, policy_id: u64) -> bool {
        let mut pos = self.positions.get(&policy_id).cloned().expect("position missing");
        self.in_flight -= pos.premium.0;
        pos.busy = false;
        if Self::callback_ok() {
            self.resolve_position(policy_id, &pos, false);
            self.assert_invariant();
            event("premium_refunded", json!({"policy_id": policy_id, "amount": pos.premium}));
            true
        } else {
            self.unearned_premiums += pos.premium.0;
            self.positions.insert(policy_id, pos);
            event("premium_refund_reverted", json!({"policy_id": policy_id}));
            false
        }
    }

    // --------------------------------------------------------------------- fees

    pub fn withdraw_fees(&mut self) -> Promise {
        let amount = self.fees_accrued;
        require!(amount > 0, "no fees");
        self.fees_accrued = 0;
        self.in_flight += amount;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(self.fee_account.clone(), U128(amount), Some("CapFare protocol fee".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_fee_transfer(U128(amount)))
    }

    #[private]
    pub fn on_fee_transfer(&mut self, amount: U128) -> bool {
        self.in_flight -= amount.0;
        if Self::callback_ok() {
            true
        } else {
            self.fees_accrued += amount.0;
            false
        }
    }

    pub fn set_registry(&mut self, registry: AccountId) {
        self.assert_owner();
        require!(self.active_positions == 0, "cannot change registry with active positions");
        self.registry = registry;
    }

    // -------------------------------------------------------------------- views

    pub fn get_state(&self) -> VaultState {
        VaultState {
            name: self.name.clone(),
            token: self.token.clone(),
            registry: self.registry.clone(),
            epoch: self.epoch,
            epoch_start: self.epoch_start,
            epoch_secs: self.epoch_secs,
            next_epoch_at: self.epoch_start + self.epoch_secs,
            total_assets: U128(self.total_assets),
            total_shares: U128(self.total_shares),
            locked_coverage: U128(self.locked_coverage),
            pending_withdrawals: U128(self.reserved_withdrawals),
            unearned_premiums: U128(self.unearned_premiums),
            fees_accrued: U128(self.fees_accrued),
            pending_deposits: U128(self.pending_deposits),
            claimable_total: U128(self.claimable_total),
            in_flight: U128(self.in_flight),
            free_liquidity: U128(self.free_liquidity_raw()),
            share_price_e6: U128(self.share_price_e6()),
            active_positions: self.active_positions,
            premiums_earned_total: U128(self.premiums_earned_total),
            payouts_total: U128(self.payouts_total),
            invariant_ok: self.total_assets >= self.locked_coverage + self.reserved_withdrawals,
            deposit_queue_len: self.deposit_queue.len(),
            withdraw_queue_len: self.withdraw_queue.len(),
        }
    }

    /// Sum of all USDC the vault should hold (for the accounting identity check).
    pub fn get_expected_token_balance(&self) -> U128 {
        U128(
            self.total_assets
                + self.unearned_premiums
                + self.fees_accrued
                + self.pending_deposits
                + self.claimable_total
                + self.in_flight,
        )
    }

    pub fn get_free_liquidity(&self) -> U128 {
        U128(self.free_liquidity_raw())
    }

    pub fn get_shares(&self, account_id: AccountId) -> U128 {
        U128(self.shares.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_share_value(&self, account_id: AccountId) -> U128 {
        U128(self.value_of_shares_floor(self.shares.get(&account_id).copied().unwrap_or(0)))
    }

    pub fn get_claimable(&self, account_id: AccountId) -> U128 {
        U128(self.claimable.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_queues(&self) -> (Vec<DepositRequest>, Vec<WithdrawRequest>) {
        (self.deposit_queue.iter().cloned().collect(), self.withdraw_queue.iter().cloned().collect())
    }

    pub fn get_position(&self, policy_id: u64) -> Option<Position> {
        self.positions.get(&policy_id).cloned()
    }

    pub fn get_history(&self, from: Option<u32>, limit: Option<u32>) -> Vec<EpochRecord> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(52);
        self.history.iter().skip(from as usize).take(limit as usize).cloned().collect()
    }
}

#[cfg(test)]
mod tests;
