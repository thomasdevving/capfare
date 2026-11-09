//! Quotes and purchases. Flow (both products):
//!   buy_* --(attestation registry view/consume  AND  vault.get_state)--> on_*_inputs
//!   on_*_inputs: price with the public formula, debit credit, create policy (Funding)
//!   --ft_transfer_call(premium -> vault, msg lock)--> on_policy_funded
//!   on_policy_funded: Active, or roll back (credit, exposure, nullifier).

use crate::ext::*;
use crate::*;
use near_sdk::{Promise, PromiseOrValue};

impl PolicyRegistry {
    pub(crate) fn check_user_limits(&self, owner: &AccountId, product: Product, fkh: &Hash32) -> Result<(), String> {
        let pp = self.params.product(product);
        let per_flight = self.user_flight_count.get(&(owner.clone(), product, *fkh)).copied().unwrap_or(0);
        if per_flight >= pp.max_per_user_per_flight {
            return Err("limit reached: policies per user for this flight".into());
        }
        let day = now_secs() / SECS_PER_DAY;
        let per_day = self.user_day_count.get(&(owner.clone(), day)).copied().unwrap_or(0);
        if per_day >= pp.max_per_user_per_day {
            return Err("limit reached: policies per user per day".into());
        }
        Ok(())
    }

    /// Prices and validates a new policy. No state changes.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_policy(
        &self,
        owner: AccountId,
        product: Product,
        flight_key: FlightKey,
        strike: u64,
        snap: &SnapshotView,
        vault: &VaultFigures,
        max_premium: u64,
        passenger_commitment: Hash32,
    ) -> Result<Policy, String> {
        let now = now_secs();
        let g = &self.params.global;
        let pp = self.params.product(product);
        let fkh = flight_key_hash(&flight_key);
        if snap.observed_at + g.max_quote_snapshot_age_secs < now {
            return Err("oracle price is too old to quote; try again shortly".into());
        }
        if !snap.available {
            return Err("this fare class is not available".into());
        }
        self.check_user_limits(&owner, product, &fkh)?;
        let flight_exposure = self.flight_exposure.get(&(product, fkh)).copied().unwrap_or(0);
        if flight_exposure + pp.max_payout > pp.flight_exposure_cap {
            return Err("sold out: coverage limit for this flight reached".into());
        }
        let rwk = route_week_key(&flight_key.origin, &flight_key.destination, snap.departure_ts);
        let rw = self.route_week_exposure.get(&(product, rwk)).copied().unwrap_or(0);
        if rw + pp.max_payout > pp.route_week_exposure_cap {
            return Err("sold out: coverage limit for this route and week reached".into());
        }
        let rate = g.usdc_micro_per_cent;
        let lock_usdc = self.usdc(pp.max_payout, rate);
        if vault.free_liquidity.0 < lock_usdc {
            return Err("not enough vault liquidity for full collateralisation".into());
        }
        let inputs = PremiumInputs {
            product,
            current_price: snap.price_minor,
            strike,
            signals: snap.signals,
            now,
            departure_ts: snap.departure_ts,
            vault_total_assets: vault.total_assets,
            vault_locked: vault.locked_coverage,
            vault_reserved: vault.pending_withdrawals,
            new_lock: U128(lock_usdc),
            flight_exposure,
        };
        let b = compute_premium(pp, &inputs).map_err(|e| e.msg().to_string())?;
        if b.premium > max_premium {
            return Err(format!("premium {} is above your maximum {}", b.premium, max_premium));
        }
        let premium_usdc = self.usdc(b.premium, rate);
        if self.credit_of(&owner) < premium_usdc {
            return Err("not enough credit; top up first".into());
        }
        let active_from = match product {
            Product::Cap => now + pp.activation_delay_secs,
            Product::Drop => now,
        };
        let expires_at = (now + pp.validity_secs).min(snap.departure_ts);
        Ok(Policy {
            id: self.next_policy_id,
            owner,
            product,
            flight_key_hash: fkh,
            flight_key,
            strike_minor: strike,
            deductible_minor: pp.deductible,
            max_payout_minor: pp.max_payout,
            premium_minor: b.premium,
            purchased_at: now,
            active_from,
            expires_at,
            departure_ts: snap.departure_ts,
            state: PolicyState::Funding,
            booking_nullifier: None,
            lowest_price_seen_minor: None,
            index_at_booking_minor: None,
            paid_price_minor: None,
            refundable: None,
            payout_minor: None,
            final_check_at: None,
            usdc_micro_per_cent: rate,
            premium_usdc: U128(premium_usdc),
            lock_usdc: U128(lock_usdc),
            route_week_key: rwk,
            passenger_commitment,
            busy: true,
            note: None,
        })
    }

    /// Debits credit, records the policy and sends the premium to the vault,
    /// which locks `max_payout` or refuses (refund).
    pub(crate) fn fund(&mut self, policy: Policy) -> Promise {
        let id = policy.id;
        self.next_policy_id += 1;
        self.policies_total += 1;
        self.sub_credit(&policy.owner, policy.premium_usdc.0);
        self.in_flight += policy.premium_usdc.0;
        let day = now_secs() / SECS_PER_DAY;
        *self.user_day_count.entry((policy.owner.clone(), day)).or_insert(0) += 1;
        self.add_exposure(&policy);
        self.owner_policies.entry(policy.owner.clone()).or_default().push(id);
        let msg = json!({"policy": {"policy_id": id, "lock": policy.lock_usdc, "fee_bps": self.params.global.protocol_fee_bps}}).to_string();
        let vault = self.vault_for(policy.product);
        let premium = policy.premium_usdc;
        event(
            "policy_purchased",
            json!({"policy_id": id, "owner": policy.owner, "product": policy.product, "flight_key_hash": policy.flight_key_hash,
                   "strike_minor": policy.strike_minor, "premium_minor": policy.premium_minor, "max_payout_minor": policy.max_payout_minor}),
        );
        self.save(policy);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER_CALL)
            .ft_transfer_call(vault, premium, Some(format!("CapFare premium policy {id}")), msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SMALL_CB).on_policy_funded(id))
    }
}

#[near]
impl PolicyRegistry {
    /// Buys a Price Cap on `flight_key` at `strike_minor` (EUR cents). The premium is
    /// computed on-chain from the latest oracle snapshot; `max_premium_minor`
    /// protects against the quote moving between display and purchase.
    /// `passenger_commitment` binds the policy to the lead passenger (computed in the app from
    /// the last name and a salt derived from the user's key; the name never leaves the device).
    pub fn buy_cap(&mut self, flight_key: FlightKey, strike_minor: u64, max_premium_minor: u64, passenger_commitment: Hash32) -> Promise {
        require!(!self.paused, "sales are paused");
        if let Err(e) = flight_key.validate() {
            env::panic_str(e);
        }
        let owner = env::predecessor_account_id();
        let fkh = flight_key_hash(&flight_key);
        if let Err(e) = self.check_user_limits(&owner, Product::Cap, &fkh) {
            env::panic_str(&e);
        }
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_VIEW)
            .get_latest_snapshot(fkh)
            .and(ext_vault::ext(self.cap_vault.clone()).with_static_gas(GAS_VIEW).get_state())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PURCHASE_CB)
                    .on_cap_inputs(owner, flight_key, strike_minor, max_premium_minor, passenger_commitment),
            )
    }

    #[private]
    pub fn on_cap_inputs(&mut self, owner: AccountId, flight_key: FlightKey, strike_minor: u64, max_premium_minor: u64, passenger_commitment: Hash32) -> Promise {
        // Nothing has changed yet, so failing here simply aborts the purchase.
        let snap: Option<SnapshotView> = promise_json(0).unwrap_or_else(|e| env::panic_str(&e));
        let snap = snap.unwrap_or_else(|| env::panic_str("no oracle price for this flight yet"));
        let vault: VaultFigures = promise_json(1).unwrap_or_else(|e| env::panic_str(&e));
        let policy = self
            .build_policy(owner, Product::Cap, flight_key, strike_minor, &snap, &vault, max_premium_minor, passenger_commitment)
            .unwrap_or_else(|e| env::panic_str(&e));
        self.fund(policy)
    }

    /// Buys a Drop Guarantee for a verified booking. The booking's nullifier is
    /// consumed for the drop product; it is released again if the purchase fails.
    pub fn buy_drop(&mut self, attestation: SignedBookingAttestation, flight_key: FlightKey, max_premium_minor: u64) -> Promise {
        require!(!self.paused, "sales are paused");
        if let Err(e) = flight_key.validate() {
            env::panic_str(e);
        }
        let owner = env::predecessor_account_id();
        let fkh = flight_key_hash(&flight_key);
        let a = &attestation.attestation;
        require!(a.flight_key_hash == fkh, "booking is for another flight");
        require!(a.fare_class == flight_key.fare_class, "booking is for another fare class");
        require!(a.status == BookingStatus::Active, "booking is not active");
        require!(a.paid_price_minor > 0, "paid price missing");
        require!(
            now_secs() <= a.booked_at + self.params.drop.purchase_window_secs,
            "a Drop Guarantee must be bought soon after booking"
        );
        if let Err(e) = self.check_user_limits(&owner, Product::Drop, &fkh) {
            env::panic_str(&e);
        }
        let g = &self.params.global;
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_ATT_CONSUME)
            .consume_booking(attestation, Product::Drop, g.max_attestation_age_secs, g.max_index_snapshot_age_secs)
            .and(ext_vault::ext(self.drop_vault.clone()).with_static_gas(GAS_VIEW).get_state())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PURCHASE_CB)
                    .on_drop_inputs(owner, flight_key, max_premium_minor),
            )
    }

    #[private]
    pub fn on_drop_inputs(&mut self, owner: AccountId, flight_key: FlightKey, max_premium_minor: u64) -> PromiseOrValue<bool> {
        let check: BookingCheckView = match promise_json(0) {
            Ok(c) => c,
            // Attestation rejected: nothing was consumed.
            Err(_) => env::panic_str("booking attestation rejected"),
        };
        let nullifier = check.attestation.booking_ref_nullifier;
        // From here on the nullifier is consumed: never panic, release it on failure.
        let result = (|| -> Result<Policy, String> {
            let vault: VaultFigures = promise_json(1)?;
            let snap = check.latest.clone().ok_or("no oracle price for this flight yet")?;
            let paid = check.attestation.paid_price_minor;
            if snap.price_minor < paid {
                return Err("the price has already dropped below what you paid; a Drop Guarantee is not available".into());
            }
            let mut p = self.build_policy(
                owner.clone(),
                Product::Drop,
                flight_key,
                paid,
                &snap,
                &vault,
                max_premium_minor,
                check.attestation.passenger_commitment,
            )?;
            p.booking_nullifier = Some(nullifier);
            p.paid_price_minor = Some(paid);
            p.refundable = Some(check.attestation.refundable);
            Ok(p)
        })();
        match result {
            Ok(p) => PromiseOrValue::Promise(self.fund(p)),
            Err(e) => {
                event("purchase_failed", json!({"owner": owner, "product": "drop", "reason": e}));
                let _ = ext_att::ext(self.attestation.clone())
                    .with_static_gas(GAS_VIEW)
                    .release_nullifier(Product::Drop, nullifier);
                PromiseOrValue::Value(false)
            }
        }
    }

    #[private]
    pub fn on_policy_funded(&mut self, policy_id: u64) -> bool {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        let premium = p.premium_usdc.0;
        self.in_flight -= premium;
        p.busy = false;
        let used = promise_json::<U128>(0).map(|u| u.0).unwrap_or(0);
        if used == premium {
            p.state = PolicyState::Active;
            event("policy_active", json!({"policy_id": policy_id, "lock_usdc": p.lock_usdc}));
            self.save(p);
            return true;
        }
        // Roll back: refund credit (whatever the vault did not keep), exposure, counters, nullifier.
        self.add_credit(&p.owner.clone(), premium - used.min(premium));
        self.remove_exposure(&p);
        let day = p.purchased_at / SECS_PER_DAY;
        if let Some(c) = self.user_day_count.get_mut(&(p.owner.clone(), day)) {
            *c = c.saturating_sub(1);
        }
        p.state = PolicyState::Voided;
        p.note = Some("vault could not lock coverage; premium returned to credit".into());
        if let (Product::Drop, Some(n)) = (p.product, p.booking_nullifier) {
            let _ = ext_att::ext(self.attestation.clone()).with_static_gas(GAS_VIEW).release_nullifier(Product::Drop, n);
        }
        event("policy_funding_failed", json!({"policy_id": policy_id}));
        self.save(p);
        false
    }
}
