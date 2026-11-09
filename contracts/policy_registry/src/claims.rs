//! Claims, settlement, final status checks, expiry, sold-out refunds, payouts.
//!
//! Payout timing (anti cancel-after-claim, brief 5.3):
//! * verified non-refundable fare  -> pay as soon as the claim is verified;
//! * refundable / unknown          -> hold until a status check verified at or after
//!   departure - FINAL_CHECK_LEAD confirms the booking is still active;
//! * final check says cancelled    -> void the claim and release coverage.

use crate::ext::*;
use crate::*;
use near_sdk::{Promise, PromiseOrValue};

impl PolicyRegistry {
    /// Sends the computed payout through the vault (amount may be 0, which just
    /// releases coverage). `target` is the state on success.
    pub(crate) fn resolve_via_vault(&mut self, mut p: Policy, amount_minor: u64, target: PolicyState) -> Promise {
        let amount_usdc = cents_to_usdc_floor(amount_minor, p.usdc_micro_per_cent).min(p.lock_usdc.0);
        p.busy = true;
        let id = p.id;
        let owner = p.owner.clone();
        let vault = self.vault_for(p.product);
        self.save(p);
        ext_vault::ext(vault)
            .with_static_gas(GAS_VAULT_PAYOUT)
            .payout(id, owner, U128(amount_usdc))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SMALL_CB).on_vault_resolved(id, target))
    }

    fn after_claim_verified(&mut self, mut p: Policy, verified_at: u64) -> PromiseOrValue<bool> {
        let payout = p.payout_minor.unwrap_or(0);
        let final_at = p.departure_ts.saturating_sub(self.params.global.final_check_lead_secs);
        let pay_now = payout == 0 || p.refundable == Some(Refundability::NonRefundable) || verified_at >= final_at;
        p.state = PolicyState::Claimed;
        if pay_now {
            p.final_check_at = None;
            PromiseOrValue::Promise(self.resolve_via_vault(p, payout, PolicyState::PaidOut))
        } else {
            p.final_check_at = Some(final_at);
            event("payout_held_for_final_check", json!({"policy_id": p.id, "payout_minor": payout, "final_check_at": final_at}));
            self.save(p);
            PromiseOrValue::Value(true)
        }
    }
}

#[near]
impl PolicyRegistry {
    /// Price Cap claim with a booking attestation (DKIM .eml or live check). For route
    /// coverage, `booked_flight` names the flight that was booked (the attestation only carries
    /// its hash); it must be on the covered route and day. Each leg of a return booking is
    /// claimed separately, against its own policy.
    pub fn claim_cap(&mut self, policy_id: u64, attestation: SignedBookingAttestation, booked_flight: Option<FlightKey>) -> Promise {
        let mut p = self.get_policy_mut_checked(policy_id);
        require!(env::predecessor_account_id() == p.owner, "only the policy owner can claim");
        require!(p.product == Product::Cap, "not a Price Cap");
        require!(p.state == PolicyState::Active, "policy is not active");
        let now = now_secs();
        require!(now <= p.expires_at + self.params.global.claim_grace_secs, "claim period is over");
        let a = &attestation.attestation;
        let booked = match &p.coverage {
            Coverage::Flight(k) => {
                require!(a.flight_key_hash == p.flight_key_hash, "booking is for another flight");
                k.clone()
            }
            Coverage::Route(r) => {
                let k = booked_flight.unwrap_or_else(|| env::panic_str("say which flight you booked"));
                if let Err(e) = k.validate() {
                    env::panic_str(e);
                }
                require!(flight_key_hash(&k) == a.flight_key_hash, "booking is for another flight");
                require!(r.matches(&k), "the booked flight is not on the covered route, day and fare class");
                k
            }
        };
        require!(a.fare_class == p.coverage.fare_class(), "booking is for another fare class");
        require!(a.status == BookingStatus::Active, "booking is not active");
        require!(a.passenger_commitment == p.passenger_commitment, "booking is for another passenger");
        require!(
            a.booked_at >= p.active_from && a.booked_at <= p.expires_at,
            "booking was made outside the coverage window (activation delay or expiry)"
        );
        let index_key = match p.coverage {
            Coverage::Route(_) => Some(p.flight_key_hash),
            Coverage::Flight(_) => None,
        };
        p.busy = true;
        self.save(p);
        let g = &self.params.global;
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_ATT_CONSUME)
            .consume_booking(attestation, Product::Cap, g.max_attestation_age_secs, g.max_index_snapshot_age_secs, index_key)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CLAIM_CB).on_cap_claim(policy_id, booked))
    }

    #[private]
    pub fn on_cap_claim(&mut self, policy_id: u64, booked: FlightKey) -> PromiseOrValue<bool> {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        p.busy = false;
        let check: BookingCheckView = match promise_json(0) {
            Ok(c) => c,
            Err(e) => {
                event("claim_rejected", json!({"policy_id": policy_id, "reason": e}));
                self.save(p);
                return PromiseOrValue::Value(false);
            }
        };
        let a = check.attestation;
        let index = check.index_price.unwrap_or(0);
        let seats = p.seats.min(a.seats);
        let per_seat = cap_payout(index, a.paid_price_minor, p.strike_minor, p.deductible_minor, p.max_payout_minor);
        let payout = per_seat * u64::from(seats);
        p.booking_nullifier = Some(a.booking_ref_nullifier);
        p.booked_flight_key_hash = Some(a.flight_key_hash);
        p.booked_flight = Some(booked);
        p.seats_covered = Some(seats);
        p.paid_price_minor = Some(a.paid_price_minor);
        p.index_at_booking_minor = Some(index);
        p.refundable = Some(a.refundable);
        p.payout_minor = Some(payout);
        event(
            "claim_verified",
            json!({"policy_id": policy_id, "index_minor": index, "paid_minor": a.paid_price_minor, "seats": seats,
                   "payout_per_seat_minor": per_seat, "payout_minor": payout, "refundable": a.refundable}),
        );
        self.after_claim_verified(p, a.verified_at)
    }

    /// Final booking-status check for held payouts (anyone may submit it).
    pub fn finalize_claim(&mut self, policy_id: u64, attestation: SignedBookingAttestation) -> Promise {
        let mut p = self.get_policy_mut_checked(policy_id);
        require!(p.state == PolicyState::Claimed, "no claim waiting");
        let at = p.final_check_at.unwrap_or_else(|| env::panic_str("no final check pending"));
        let nullifier = p.booking_nullifier.expect("nullifier");
        p.busy = true;
        let (fkh, pc) = (p.status_key(), p.passenger_commitment);
        self.save(p);
        // A final check exists only for refundable/unknown fares: it must be live.
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_VIEW)
            .check_status(attestation, nullifier, fkh, pc, true, at, self.params.global.max_attestation_age_secs, None, None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CLAIM_CB).on_final_check(policy_id))
    }

    #[private]
    pub fn on_final_check(&mut self, policy_id: u64) -> PromiseOrValue<bool> {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        p.busy = false;
        let r: StatusCheckView = match promise_json(0) {
            Ok(r) => r,
            Err(e) => {
                event("final_check_rejected", json!({"policy_id": policy_id, "reason": e}));
                self.save(p);
                return PromiseOrValue::Value(false);
            }
        };
        match r.status {
            BookingStatus::Active => {
                p.final_check_at = None;
                let payout = p.payout_minor.unwrap_or(0);
                PromiseOrValue::Promise(self.resolve_via_vault(p, payout, PolicyState::PaidOut))
            }
            BookingStatus::Cancelled => {
                p.note = Some("booking cancelled before departure; claim voided".into());
                p.payout_minor = Some(0);
                PromiseOrValue::Promise(self.resolve_via_vault(p, 0, PolicyState::Voided))
            }
            BookingStatus::Unknown => {
                self.save(p);
                PromiseOrValue::Value(false)
            }
        }
    }

    /// Retries a verified payout whose token transfer failed (e.g. the receiver
    /// was not registered with the token yet).
    pub fn retry_payout(&mut self, policy_id: u64) -> Promise {
        let p = self.get_policy_mut_checked(policy_id);
        require!(p.state == PolicyState::Claimed && p.final_check_at.is_none(), "nothing to retry");
        let payout = p.payout_minor.unwrap_or(0);
        self.resolve_via_vault(p, payout, PolicyState::PaidOut)
    }

    /// Drop Guarantee settlement at the end of the window, with a status check
    /// verified at or after `expires_at`. Anyone may submit it.
    pub fn settle_drop(&mut self, policy_id: u64, attestation: SignedBookingAttestation) -> Promise {
        let mut p = self.get_policy_mut_checked(policy_id);
        require!(p.product == Product::Drop, "not a Drop Guarantee");
        require!(p.state == PolicyState::Active, "policy is not active");
        let now = now_secs();
        require!(now >= p.expires_at, "the drop window has not ended");
        require!(now <= p.expires_at + self.params.global.claim_grace_secs, "settlement period is over");
        let nullifier = p.booking_nullifier.expect("nullifier");
        p.busy = true;
        let (fkh, from, to, pc) = (p.status_key(), p.purchased_at, p.expires_at, p.passenger_commitment);
        let live = p.refundable != Some(Refundability::NonRefundable);
        self.save(p);
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_ATT_CONSUME)
            .check_status(attestation, nullifier, fkh, pc, live, to, self.params.global.max_attestation_age_secs, Some(from), Some(to))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CLAIM_CB).on_drop_settled(policy_id))
    }

    #[private]
    pub fn on_drop_settled(&mut self, policy_id: u64) -> PromiseOrValue<bool> {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        p.busy = false;
        let r: StatusCheckView = match promise_json(0) {
            Ok(r) => r,
            Err(e) => {
                event("settlement_rejected", json!({"policy_id": policy_id, "reason": e}));
                self.save(p);
                return PromiseOrValue::Value(false);
            }
        };
        match r.status {
            BookingStatus::Cancelled => {
                p.note = Some("booking cancelled; no payout".into());
                p.payout_minor = Some(0);
                PromiseOrValue::Promise(self.resolve_via_vault(p, 0, PolicyState::Voided))
            }
            BookingStatus::Unknown => {
                self.save(p);
                PromiseOrValue::Value(false)
            }
            BookingStatus::Active => {
                let paid = p.paid_price_minor.unwrap_or(p.strike_minor);
                let lowest = r.lowest_price.unwrap_or(paid);
                let seats = p.seats_covered.unwrap_or(p.seats);
                let payout = drop_payout(paid, lowest, p.deductible_minor, p.max_payout_minor) * u64::from(seats);
                p.lowest_price_seen_minor = Some(lowest);
                p.payout_minor = Some(payout);
                if r.refundable == Refundability::NonRefundable {
                    p.refundable = Some(Refundability::NonRefundable);
                }
                event("drop_settled", json!({"policy_id": policy_id, "lowest_minor": lowest, "payout_minor": payout}));
                self.after_claim_verified(p, r.verified_at)
            }
        }
    }

    /// Closes a held claim (refundable or unknown fare) whose final booking check was never
    /// submitted: after departure + grace, coverage goes back to the vault and nothing is paid.
    /// Without this, the locked coverage would stay out of LPs' reach forever. Anyone may call.
    pub fn void_unconfirmed_claim(&mut self, policy_id: u64) -> Promise {
        let mut p = self.get_policy_mut_checked(policy_id);
        require!(p.state == PolicyState::Claimed && p.final_check_at.is_some(), "no claim is waiting for a final check");
        require!(
            now_secs() > p.departure_ts + self.params.global.claim_grace_secs,
            "the final booking check can still be done"
        );
        p.note = Some("final booking check not done in time; claim closed without payout".into());
        p.final_check_at = None;
        p.payout_minor = Some(0);
        event("claim_unconfirmed", json!({"policy_id": policy_id}));
        self.resolve_via_vault(p, 0, PolicyState::Voided)
    }

    /// Releases coverage of an unclaimed policy after expiry + grace. Anyone may call.
    pub fn expire(&mut self, policy_id: u64) -> Promise {
        let p = self.get_policy_mut_checked(policy_id);
        require!(p.state == PolicyState::Active, "policy is not active");
        require!(now_secs() > p.expires_at + self.params.global.claim_grace_secs, "not expired yet");
        self.resolve_via_vault(p, 0, PolicyState::Expired)
    }

    #[private]
    pub fn on_vault_resolved(&mut self, policy_id: u64, target: PolicyState) -> bool {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        p.busy = false;
        let ok = promise_json::<bool>(0).unwrap_or(false);
        if ok {
            p.state = target;
            self.remove_exposure(&p);
            event(
                "policy_resolved",
                json!({"policy_id": policy_id, "state": target, "payout_minor": p.payout_minor.unwrap_or(0), "owner": p.owner}),
            );
        } else {
            if p.state == PolicyState::Active && target == PolicyState::Expired {
                // Release failed: stays Active, can be expired again.
            } else {
                p.state = PolicyState::Claimed;
                p.note = Some("payout transfer failed; call retry_payout after registering with the token".into());
            }
            event("payout_failed", json!({"policy_id": policy_id}));
        }
        self.save(p);
        ok
    }

    /// Sold-out handling (if enabled): when the oracle reports the covered fare
    /// class as unavailable while a cap is active and unclaimed, the premium is
    /// refunded to the owner's credit and coverage released. Anyone may call.
    pub fn refund_sold_out(&mut self, policy_id: u64) -> Promise {
        require!(self.params.global.sold_out_premium_refund, "sold-out refunds are disabled");
        let mut p = self.get_policy_mut_checked(policy_id);
        require!(p.product == Product::Cap, "only Price Caps");
        require!(p.state == PolicyState::Active, "policy is not active");
        require!(now_secs() <= p.expires_at, "policy has expired");
        p.busy = true;
        let fkh = p.flight_key_hash;
        self.save(p);
        ext_att::ext(self.attestation.clone())
            .with_static_gas(GAS_VIEW)
            .get_latest_snapshot(fkh)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CLAIM_CB).on_sold_out_check(policy_id))
    }

    #[private]
    pub fn on_sold_out_check(&mut self, policy_id: u64) -> PromiseOrValue<bool> {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        p.busy = false;
        let snap: Option<SnapshotView> = promise_json(0).unwrap_or(None);
        let sold_out = matches!(&snap, Some(s) if !s.available && s.observed_at >= p.purchased_at);
        if !sold_out {
            self.save(p);
            return PromiseOrValue::Value(false);
        }
        p.busy = true;
        let vault = self.vault_for(p.product);
        self.save(p);
        PromiseOrValue::Promise(
            ext_vault::ext(vault)
                .with_static_gas(GAS_VAULT_PAYOUT)
                .refund_premium(policy_id, env::current_account_id())
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SMALL_CB).on_premium_refunded(policy_id)),
        )
    }

    #[private]
    pub fn on_premium_refunded(&mut self, policy_id: u64) -> bool {
        let mut p = self.policies.get(&policy_id).cloned().expect("policy");
        p.busy = false;
        let ok = promise_json::<bool>(0).unwrap_or(false);
        if ok {
            // The vault sent the premium back to this contract: credit the owner.
            self.add_credit(&p.owner.clone(), p.premium_usdc.0);
            p.state = PolicyState::Refunded;
            p.note = Some("fare class sold out; premium refunded to credit".into());
            self.remove_exposure(&p);
            event("premium_refunded", json!({"policy_id": policy_id, "amount_usdc": p.premium_usdc}));
        }
        self.save(p);
        ok
    }
}
