//! Quotes and purchases. Flow (both products):
//!   buy_* --(attestation registry view/consume  AND  vault.get_state)--> on_*_inputs
//!   on_*_inputs: price with the public formula, debit credit, create policy (Funding)
//!   --ft_transfer_call(premium -> vault, msg lock)--> on_policy_funded
//!   on_policy_funded: Active, or roll back (credit, exposure, nullifier).
//!
//! Seats: one policy can cover several travellers on the same booking. Strike, deductible
//! and max payout are per traveller; the premium, the locked coverage and the exposure are
//! per traveller times seats. The per-traveller premium comes from the unchanged public
//! formula, with the flight-concentration and utilisation terms seeing the whole policy.
//!
//! Trips: `buy_caps` buys up to two legs (outbound and return) in one call. All legs are
//! priced and checked before anything is final: if one leg fails, the whole call panics and
//! no state changes. Each leg is then funded separately.

use crate::ext::*;
use crate::*;
use near_sdk::{Promise, PromiseOrValue};

pub const MAX_LEGS: usize = 2;

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
        coverage: Coverage,
        seats: u8,
        strike: u64,
        snap: &SnapshotView,
        vault: &VaultFigures,
        max_premium: u64,
        passenger_commitment: Hash32,
    ) -> Result<Policy, String> {
        let now = now_secs();
        let g = &self.params.global;
        let pp = self.params.product(product);
        if seats == 0 || seats > MAX_SEATS {
            return Err(format!("cover 1 to {MAX_SEATS} travellers per policy"));
        }
        let fkh = coverage_hash(&coverage);
        if snap.observed_at + g.max_quote_snapshot_age_secs < now {
            return Err("oracle price is too old to quote; try again shortly".into());
        }
        if !snap.available {
            return Err("this fare class is not available".into());
        }
        self.check_user_limits(&owner, product, &fkh)?;
        let exposure = pp.max_payout * u64::from(seats);
        let flight_exposure = self.flight_exposure.get(&(product, fkh)).copied().unwrap_or(0);
        if flight_exposure + exposure > pp.flight_exposure_cap {
            return Err("sold out: coverage limit for this flight reached".into());
        }
        let rwk = route_week_key(coverage.origin(), coverage.destination(), snap.departure_ts);
        let rw = self.route_week_exposure.get(&(product, rwk)).copied().unwrap_or(0);
        if rw + exposure > pp.route_week_exposure_cap {
            return Err("sold out: coverage limit for this route and week reached".into());
        }
        let rate = g.usdc_micro_per_cent;
        let lock_usdc = self.usdc(exposure, rate);
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
            // The formula adds one max payout itself; the other seats count as exposure.
            flight_exposure: flight_exposure + pp.max_payout * u64::from(seats - 1),
        };
        let b = compute_premium(pp, &inputs).map_err(|e| e.msg().to_string())?;
        let premium = b.premium * u64::from(seats);
        if premium > max_premium {
            return Err(format!("premium {} is above your maximum {}", premium, max_premium));
        }
        let premium_usdc = self.usdc(premium, rate);
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
            coverage,
            seats,
            strike_minor: strike,
            deductible_minor: pp.deductible,
            max_payout_minor: pp.max_payout,
            premium_minor: premium,
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
            booked_flight: None,
            booked_flight_key_hash: None,
            seats_covered: None,
            trip_id: None,
            auto_drop_max_premium_minor: None,
            linked_policy: None,
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
    /// which locks the coverage or refuses (refund).
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
        let kind = match policy.coverage {
            Coverage::Flight(_) => "flight",
            Coverage::Route(_) => "route",
        };
        event(
            "policy_purchased",
            json!({"policy_id": id, "owner": policy.owner, "product": policy.product, "flight_key_hash": policy.flight_key_hash,
                   "coverage": kind, "seats": policy.seats, "trip_id": policy.trip_id, "linked_policy": policy.linked_policy,
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

fn validate_purchase(p: &CapPurchase) {
    require!(!p.legs.is_empty() && p.legs.len() <= MAX_LEGS, "buy one or two legs (outbound and return)");
    require!(p.seats >= 1 && p.seats <= MAX_SEATS, "cover 1 to 9 travellers per policy");
    for l in &p.legs {
        if let Err(e) = l.coverage.validate() {
            env::panic_str(e);
        }
    }
    if p.legs.len() == 2 {
        require!(coverage_hash(&p.legs[0].coverage) != coverage_hash(&p.legs[1].coverage), "the two legs must be different flights");
    }
}

#[near]
impl PolicyRegistry {
    /// Buys a Price Cap on one flight for one traveller (kept for simple clients; see
    /// `buy_caps` for travellers, return trips, route coverage and the Drop option).
    /// `passenger_commitment` binds the policy to the lead passenger (computed in the app from
    /// the last name and a salt derived from the user's key; the name never leaves the device).
    pub fn buy_cap(&mut self, flight_key: FlightKey, strike_minor: u64, max_premium_minor: u64, passenger_commitment: Hash32) -> Promise {
        self.buy_caps(CapPurchase {
            legs: vec![CapLeg { coverage: Coverage::Flight(flight_key), strike_minor, max_premium_minor }],
            seats: 1,
            passenger_commitment,
            auto_drop_max_premium_minor: None,
        })
    }

    /// Buys Price Caps: one or two legs, each one exact flight or any flight on a route and
    /// day, for 1..=9 travellers on one booking. Premiums are computed on-chain from the latest
    /// oracle snapshots; each leg's `max_premium_minor` protects against quote moves.
    pub fn buy_caps(&mut self, purchase: CapPurchase) -> Promise {
        require!(!self.paused, "sales are paused");
        validate_purchase(&purchase);
        let owner = env::predecessor_account_id();
        for l in &purchase.legs {
            if let Err(e) = self.check_user_limits(&owner, Product::Cap, &coverage_hash(&l.coverage)) {
                env::panic_str(&e);
            }
        }
        let snap = |c: &Coverage| ext_att::ext(self.attestation.clone()).with_static_gas(GAS_VIEW).get_latest_snapshot(coverage_hash(c));
        let mut inputs = snap(&purchase.legs[0].coverage);
        if let Some(l) = purchase.legs.get(1) {
            inputs = inputs.and(snap(&l.coverage));
        }
        let gas = if purchase.legs.len() == 2 { GAS_PURCHASE_CB_TRIP } else { GAS_PURCHASE_CB };
        inputs
            .and(ext_vault::ext(self.cap_vault.clone()).with_static_gas(GAS_VIEW).get_state())
            .then(Self::ext(env::current_account_id()).with_static_gas(gas).on_cap_inputs(owner, purchase))
    }

    #[private]
    pub fn on_cap_inputs(&mut self, owner: AccountId, purchase: CapPurchase) -> Promise {
        // Nothing has changed yet, so failing here simply aborts the whole purchase. Legs are
        // funded one after another; a panic on the second leg also reverts the first.
        let n = purchase.legs.len();
        let mut vault: VaultFigures = promise_json(n as u64).unwrap_or_else(|e| env::panic_str(&e));
        let first_id = self.next_policy_id;
        // Phase 1: price and check every leg. No state changes, so any failure aborts all legs.
        let mut drafts: Vec<Policy> = Vec::with_capacity(n);
        for (i, leg) in purchase.legs.into_iter().enumerate() {
            let snap: Option<SnapshotView> = promise_json(i as u64).unwrap_or_else(|e| env::panic_str(&e));
            let snap = snap.unwrap_or_else(|| env::panic_str("no oracle price for this flight yet"));
            let mut p = self
                .build_policy(owner.clone(), Product::Cap, leg.coverage, purchase.seats, leg.strike_minor, &snap, &vault, leg.max_premium_minor, purchase.passenger_commitment)
                .unwrap_or_else(|e| env::panic_str(&e));
            p.id = first_id + i as u64;
            if n == 2 {
                p.trip_id = Some(first_id);
            }
            p.auto_drop_max_premium_minor = purchase.auto_drop_max_premium_minor;
            // The next leg sees this leg's lock in the vault figures.
            vault.locked_coverage = U128(vault.locked_coverage.0 + p.lock_usdc.0);
            vault.free_liquidity = U128(vault.free_liquidity.0.saturating_sub(p.lock_usdc.0));
            drafts.push(p);
        }
        // Checks that only make sense for the legs together.
        let total: u128 = drafts.iter().map(|p| p.premium_usdc.0).sum();
        if self.credit_of(&owner) < total {
            env::panic_str("not enough credit for both legs; top up first");
        }
        let pp = &self.params.cap;
        let day = now_secs() / SECS_PER_DAY;
        let today = self.user_day_count.get(&(owner.clone(), day)).copied().unwrap_or(0);
        if today + n as u32 > pp.max_per_user_per_day {
            env::panic_str("limit reached: policies per user per day");
        }
        if n == 2 && drafts[0].route_week_key == drafts[1].route_week_key {
            let rw = self.route_week_exposure.get(&(Product::Cap, drafts[0].route_week_key)).copied().unwrap_or(0);
            if rw + drafts[0].exposure_minor() + drafts[1].exposure_minor() > pp.route_week_exposure_cap {
                env::panic_str("sold out: coverage limit for this route and week reached");
            }
        }
        // Phase 2: record and fund. Later legs run detached; the call returns the first leg's result.
        let mut promises: Vec<Promise> = drafts.into_iter().map(|p| self.fund(p)).collect();
        promises.swap_remove(0)
    }

    /// Buys a Drop Guarantee for a verified booking (all travellers on it). The booking's
    /// nullifier is consumed for the drop product; it is released again if the purchase fails.
    /// `from_cap`: the Price Cap that was claimed with this same booking (opt-in "Drop after
    /// claim"); the two policies are linked.
    pub fn buy_drop(&mut self, attestation: SignedBookingAttestation, flight_key: FlightKey, max_premium_minor: u64, from_cap: Option<u64>) -> Promise {
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
        if let Some(cap_id) = from_cap {
            let cap = self.policies.get(&cap_id).unwrap_or_else(|| env::panic_str("unknown policy"));
            require!(cap.owner == owner, "not your Price Cap");
            require!(cap.product == Product::Cap, "not a Price Cap");
            require!(cap.linked_policy.is_none(), "this Price Cap already has a Drop Guarantee");
            require!(
                cap.booking_nullifier == Some(a.booking_ref_nullifier) && cap.booked_flight_key_hash == Some(fkh),
                "this booking is not the one your Price Cap was claimed with"
            );
        }
        if let Err(e) = self.check_user_limits(&owner, Product::Drop, &fkh) {
            env::panic_str(&e);
        }
        let g = &self.params.global;
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_ATT_CONSUME)
            .consume_booking(attestation, Product::Drop, g.max_attestation_age_secs, g.max_index_snapshot_age_secs, None)
            .and(ext_vault::ext(self.drop_vault.clone()).with_static_gas(GAS_VIEW).get_state())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PURCHASE_CB)
                    .on_drop_inputs(owner, flight_key, max_premium_minor, from_cap),
            )
    }

    #[private]
    pub fn on_drop_inputs(&mut self, owner: AccountId, flight_key: FlightKey, max_premium_minor: u64, from_cap: Option<u64>) -> PromiseOrValue<bool> {
        let check: BookingCheckView = match promise_json(0) {
            Ok(c) => c,
            // Attestation rejected: nothing was consumed.
            Err(_) => env::panic_str("booking attestation rejected"),
        };
        let nullifier = check.attestation.booking_ref_nullifier;
        let fkh = check.attestation.flight_key_hash;
        // From here on the nullifier is consumed: never panic, release it on failure.
        let result = (|| -> Result<Policy, String> {
            let vault: VaultFigures = promise_json(1)?;
            let snap = check.latest.clone().ok_or("no oracle price for this flight yet")?;
            let paid = check.attestation.paid_price_minor;
            if snap.price_minor < paid {
                return Err("the price has already dropped below what you paid; a Drop Guarantee is not available".into());
            }
            let seats = check.attestation.seats;
            let mut p = self.build_policy(
                owner.clone(),
                Product::Drop,
                Coverage::Flight(flight_key.clone()),
                seats,
                paid,
                &snap,
                &vault,
                max_premium_minor,
                check.attestation.passenger_commitment,
            )?;
            p.booking_nullifier = Some(nullifier);
            p.paid_price_minor = Some(paid);
            p.refundable = Some(check.attestation.refundable);
            p.booked_flight = Some(flight_key.clone());
            p.booked_flight_key_hash = Some(fkh);
            p.seats_covered = Some(seats);
            if let Some(cap_id) = from_cap {
                let cap = self.policies.get(&cap_id).ok_or("unknown policy")?;
                if cap.linked_policy.is_some() {
                    return Err("this Price Cap already has a Drop Guarantee".into());
                }
                p.linked_policy = Some(cap_id);
                p.trip_id = cap.trip_id;
            }
            Ok(p)
        })();
        match result {
            Ok(p) => {
                if let Some(cap_id) = p.linked_policy {
                    // Only the link field changes; the cap may have a payout in flight.
                    if let Some(cap) = self.policies.get_mut(&cap_id) {
                        cap.linked_policy = Some(p.id);
                    }
                }
                PromiseOrValue::Promise(self.fund(p))
            }
            Err(e) => {
                event("purchase_failed", json!({"owner": owner, "product": "drop", "reason": e}));
                let _ = ext_att::ext(self.attestation.clone())
                    .with_static_gas(GAS_VIEW)
                    .release_nullifier(Product::Drop, nullifier, fkh);
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
        // Roll back: refund credit (whatever the vault did not keep), exposure, counters, nullifier, link.
        self.add_credit(&p.owner.clone(), premium - used.min(premium));
        self.remove_exposure(&p);
        let day = p.purchased_at / SECS_PER_DAY;
        if let Some(c) = self.user_day_count.get_mut(&(p.owner.clone(), day)) {
            *c = c.saturating_sub(1);
        }
        p.state = PolicyState::Voided;
        p.note = Some("vault could not lock coverage; premium returned to credit".into());
        if let (Product::Drop, Some(n), Some(f)) = (p.product, p.booking_nullifier, p.booked_flight_key_hash) {
            let _ = ext_att::ext(self.attestation.clone()).with_static_gas(GAS_VIEW).release_nullifier(Product::Drop, n, f);
        }
        if let (Product::Drop, Some(cap_id)) = (p.product, p.linked_policy) {
            if let Some(cap) = self.policies.get_mut(&cap_id) {
                if cap.linked_policy == Some(policy_id) {
                    cap.linked_policy = None;
                }
            }
        }
        event("policy_funding_failed", json!({"policy_id": policy_id}));
        self.save(p);
        false
    }
}
