use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const T0: u64 = 1_800_000_000;
const PC: Hash32 = Hash32([6u8; 32]);

fn ctx(pred: AccountId, now: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("registry.test".parse().unwrap())
        .predecessor_account_id(pred)
        .block_timestamp(now * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

fn token() -> AccountId { "usdc.test".parse().unwrap() }

fn fk() -> FlightKey {
    FlightKey {
        airline: "KL".into(),
        flight_number: "KL1695".into(),
        departure_date: "2027-01-24".into(),
        origin: "AMS".into(),
        destination: "BCN".into(),
        fare_class: "economy_light".into(),
    }
}

fn setup() -> PolicyRegistry {
    near_sdk::mock::with_mocked_blockchain(|bc| { bc.take_storage(); });
    ctx(accounts(0), T0, vec![]);
    let mut r = PolicyRegistry::new(
        accounts(0), token(), "att.test".parse().unwrap(), "cap.test".parse().unwrap(), "drop.test".parse().unwrap(),
        Params::example(),
    );
    ctx(token(), T0, vec![]);
    let _ = r.ft_on_transfer(accounts(1), U128(50_000_000), "\"top_up\"".into());
    r
}

fn snap_json(price: u64, observed: u64, available: bool) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "price_minor": price, "available": available,
        "signals": {"momentum_bucket": 2, "availability_bucket": 1, "season_flag": false},
        "departure_ts": T0 + 40 * 86_400, "observed_at": observed, "demo": true
    })).unwrap()
}

fn vault_json(total: u128) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "total_assets": total.to_string(), "locked_coverage": "0", "pending_withdrawals": "0", "free_liquidity": total.to_string()
    })).unwrap()
}

fn one_leg(fk: FlightKey, strike: u64, max_premium: u64) -> CapPurchase {
    CapPurchase {
        legs: vec![CapLeg { coverage: Coverage::Flight(fk), strike_minor: strike, max_premium_minor: max_premium }],
        seats: 1,
        passenger_commitment: PC,
        auto_drop_max_premium_minor: None,
    }
}

fn buy(r: &mut PolicyRegistry, now: u64) -> u64 {
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(snap_json(17_000, now - 60, true)),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let _ = r.on_cap_inputs(accounts(1), one_leg(fk(), 18_000, 5_000));
    r.next_policy_id - 1
}

#[test]
fn cap_purchase_debits_credit_and_activates() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.state, PolicyState::Funding);
    assert_eq!(p.active_from, T0 + 100 + 86_400);
    let credit_after = r.get_credit(accounts(1)).0;
    assert_eq!(credit_after, 50_000_000 - p.premium_usdc.0);
    ctx("registry.test".parse().unwrap(), T0 + 101, vec![PromiseResult::Successful(serde_json::to_vec(&p.premium_usdc).unwrap())]);
    assert!(r.on_policy_funded(id));
    assert_eq!(r.get_policy(id).unwrap().state, PolicyState::Active);
    assert_eq!(r.get_flight_exposure(Product::Cap, p.flight_key_hash).0, 10_000);
    assert_eq!(r.get_expected_token_balance().0, credit_after);
}

#[test]
fn funding_failure_rolls_back_credit_and_exposure() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    let p = r.get_policy(id).unwrap();
    // Vault refused the lock -> ft_resolve_transfer reports 0 used.
    ctx("registry.test".parse().unwrap(), T0 + 101, vec![PromiseResult::Successful(b"\"0\"".to_vec())]);
    assert!(!r.on_policy_funded(id));
    assert_eq!(r.get_credit(accounts(1)).0, 50_000_000);
    assert_eq!(r.get_policy(id).unwrap().state, PolicyState::Voided);
    assert_eq!(r.get_flight_exposure(Product::Cap, p.flight_key_hash).0, 0);
    assert_eq!(r.get_stats().in_flight.0, 0);
    // A failed promise (e.g. vault not registered on the token) behaves the same.
    let id2 = buy(&mut r, T0 + 200);
    ctx("registry.test".parse().unwrap(), T0 + 201, vec![PromiseResult::Failed]);
    assert!(!r.on_policy_funded(id2));
    assert_eq!(r.get_credit(accounts(1)).0, 50_000_000);
}

#[test]
#[should_panic(expected = "oracle price is too old")]
fn stale_quote_snapshot_rejected() {
    let mut r = setup();
    let now = T0 + 10_000;
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(snap_json(17_000, now - 4_000, true)),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let _ = r.on_cap_inputs(accounts(1), one_leg(fk(), 18_000, 5_000));
}

#[test]
#[should_panic(expected = "cap must be at or above the current price")]
fn strike_below_price_rejected() {
    let mut r = setup();
    let now = T0 + 100;
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(snap_json(17_000, now - 60, true)),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let _ = r.on_cap_inputs(accounts(1), one_leg(fk(), 16_000, 5_000));
}

#[test]
#[should_panic(expected = "not enough vault liquidity")]
fn needs_full_collateral() {
    let mut r = setup();
    let now = T0 + 100;
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(snap_json(17_000, now - 60, true)),
        PromiseResult::Successful(vault_json(1_000_000)),
    ]);
    let _ = r.on_cap_inputs(accounts(1), one_leg(fk(), 18_000, 5_000));
}

#[test]
fn per_user_flight_limit() {
    let mut r = setup();
    buy(&mut r, T0 + 100);
    buy(&mut r, T0 + 110);
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { buy(&mut r, T0 + 120); }));
    assert!(res.is_err(), "third policy on the same flight must be refused");
}

#[test]
fn flight_exposure_cap_enforced() {
    let mut r = setup();
    let mut params = Params::example();
    params.cap.flight_exposure_cap = 10_000; // exactly one policy
    params.cap.max_per_user_per_flight = 5;
    r.params = params;
    buy(&mut r, T0 + 100);
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { buy(&mut r, T0 + 120); }));
    assert!(res.is_err());
}

#[test]
fn params_need_timelock() {
    let mut r = setup();
    ctx(accounts(0), T0, vec![]);
    let mut p = Params::example();
    p.cap.deductible = 2_000;
    r.propose_params(p.clone());
    ctx(accounts(3), T0 + 100, vec![]);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.apply_params()));
    assert!(early.is_err());
    // Panic consumed the pending entry in this in-memory copy; re-propose.
    ctx(accounts(0), T0 + 100, vec![]);
    r.propose_params(p.clone());
    ctx(accounts(3), T0 + 100 + 2 * 86_400, vec![]);
    r.apply_params();
    assert_eq!(r.get_params().cap.deductible, 2_000);
}

#[test]
#[should_panic(expected = "only the owner")]
fn only_owner_proposes_params() {
    let mut r = setup();
    ctx(accounts(2), T0, vec![]);
    r.propose_params(Params::example());
}

fn activate(r: &mut PolicyRegistry, id: u64, now: u64) {
    let p = r.get_policy(id).unwrap();
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(serde_json::to_vec(&p.premium_usdc).unwrap())]);
    assert!(r.on_policy_funded(id));
}

fn check_json(paid: u64, index: u64, refundable: &str, verified_at: u64) -> Vec<u8> {
    check_json_for(&fk(), paid, index, refundable, verified_at, 1)
}

fn check_json_for(flight: &FlightKey, paid: u64, index: u64, refundable: &str, verified_at: u64, seats: u8) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "attestation": {
            "flight_key_hash": flight_key_hash(flight), "paid_price_minor": paid, "currency": "EUR",
            "fare_class": flight.fare_class, "refundable": refundable, "booking_ref_nullifier": Hash32([3; 32]),
            "status": "active", "method": "dkim_eml", "booked_at": verified_at - 100, "verified_at": verified_at,
            "enclave_measurement": Hash32([1; 32]), "passenger_commitment": PC, "seats": seats
        },
        "index_price": index, "latest": null
    })).unwrap()
}

fn signed(check: &[u8]) -> SignedBookingAttestation {
    let a: BookingCheckView = serde_json::from_slice(check).unwrap();
    SignedBookingAttestation { attestation: a.attestation, signer: Hash32([0; 32]), signature: Sig64([0; 64]) }
}

#[test]
fn cap_claim_non_refundable_pays_immediately() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    // Pretend claim_cap ran (busy flag) and attestation verified.
    let now = T0 + 100 + 2 * 86_400;
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json(25_500, 26_000, "non_refundable", now - 10))]);
    let _ = r.on_cap_claim(id, fk());
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.payout_minor, Some(6_500));
    assert!(p.busy);
    assert_eq!(p.state, PolicyState::Claimed);
    // Vault payout succeeded.
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(b"true".to_vec())]);
    assert!(r.on_vault_resolved(id, PolicyState::PaidOut));
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.state, PolicyState::PaidOut);
    assert_eq!(r.get_flight_exposure(Product::Cap, p.flight_key_hash).0, 0);
}

#[test]
fn cap_claim_refundable_is_held_then_voided_on_cancel() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json(25_500, 26_000, "refundable", now - 10))]);
    let _ = r.on_cap_claim(id, fk());
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.state, PolicyState::Claimed);
    assert!(!p.busy);
    assert_eq!(p.final_check_at, Some(p.departure_ts - 86_400));
    // Final check says cancelled -> void via vault release.
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(serde_json::to_vec(&json!({
        "status": "cancelled", "refundable": "refundable", "verified_at": p.departure_ts - 80_000, "lowest_price": null
    })).unwrap())]);
    let _ = r.on_final_check(id);
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(b"true".to_vec())]);
    assert!(r.on_vault_resolved(id, PolicyState::Voided));
    assert_eq!(r.get_policy(id).unwrap().state, PolicyState::Voided);
}

#[test]
fn failed_payout_transfer_can_be_retried() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json(25_500, 26_000, "non_refundable", now - 10))]);
    let _ = r.on_cap_claim(id, fk());
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(b"false".to_vec())]);
    assert!(!r.on_vault_resolved(id, PolicyState::PaidOut));
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.state, PolicyState::Claimed);
    assert!(!p.busy);
    ctx(accounts(4), now + 10, vec![]);
    let _ = r.retry_payout(id);
    assert!(r.get_policy(id).unwrap().busy);
}

#[test]
fn claim_rejection_clears_busy_flag() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    ctx("registry.test".parse().unwrap(), T0 + 200, vec![PromiseResult::Failed]);
    let _ = r.on_cap_claim(id, fk());
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.state, PolicyState::Active);
    assert!(!p.busy);
}

#[test]
#[should_panic(expected = "outside the coverage window")]
fn booking_before_activation_rejected() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    let now = T0 + 3600;
    ctx(accounts(1), now, vec![]);
    let _ = r.claim_cap(id, signed(&check_json(25_500, 26_000, "non_refundable", now - 10)), None);
}

#[test]
fn credit_withdrawal_rollback() {
    let mut r = setup();
    ctx(accounts(1), T0, vec![]);
    let _ = r.withdraw_credit(U128(10_000_000));
    assert_eq!(r.get_credit(accounts(1)).0, 40_000_000);
    ctx("registry.test".parse().unwrap(), T0, vec![PromiseResult::Failed]);
    assert!(!r.on_credit_withdrawn(accounts(1), U128(10_000_000)));
    assert_eq!(r.get_credit(accounts(1)).0, 50_000_000);
    assert_eq!(r.get_expected_token_balance().0, 50_000_000);
}

#[test]
fn drop_purchase_failure_releases_nullifier_without_panicking() {
    let mut r = setup();
    let now = T0 + 100;
    // Price already below paid price -> purchase refused, nullifier released.
    let mut check: serde_json::Value = serde_json::from_slice(&check_json(22_000, 0, "non_refundable", now - 10)).unwrap();
    check["latest"] = serde_json::from_slice(&snap_json(19_500, now - 60, true)).unwrap();
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(serde_json::to_vec(&check).unwrap()),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let r1 = r.on_drop_inputs(accounts(1), fk(), 5_000, None);
    assert!(matches!(r1, near_sdk::PromiseOrValue::Value(false)));
    assert_eq!(r.get_credit(accounts(1)).0, 50_000_000);
}

#[test]
fn drop_settlement_payout() {
    let mut r = setup();
    let now = T0 + 100;
    let mut check: serde_json::Value = serde_json::from_slice(&check_json(22_000, 0, "non_refundable", now - 10)).unwrap();
    check["latest"] = serde_json::from_slice(&snap_json(22_000, now - 60, true)).unwrap();
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(serde_json::to_vec(&check).unwrap()),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let _ = r.on_drop_inputs(accounts(1), fk(), 5_000, None);
    let id = r.next_policy_id - 1;
    activate(&mut r, id, now);
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.strike_minor, 22_000);
    let end = p.expires_at + 10;
    ctx("registry.test".parse().unwrap(), end, vec![PromiseResult::Successful(serde_json::to_vec(&json!({
        "status": "active", "refundable": "non_refundable", "verified_at": end - 5, "lowest_price": 19_500
    })).unwrap())]);
    let _ = r.on_drop_settled(id);
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.payout_minor, Some(2_000));
    assert_eq!(p.lowest_price_seen_minor, Some(19_500));
    assert!(p.busy);
}

#[test]
#[should_panic(expected = "booking is for another passenger")]
fn claim_with_someone_elses_booking_rejected() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    ctx(accounts(1), now, vec![]);
    let mut a: BookingCheckView = serde_json::from_slice(&check_json(25_500, 26_000, "non_refundable", now - 10)).unwrap();
    a.attestation.passenger_commitment = Hash32([9; 32]);
    let _ = r.claim_cap(id, SignedBookingAttestation { attestation: a.attestation, signer: Hash32([0; 32]), signature: Sig64([0; 64]) }, None);
}

#[test]
fn drop_policy_takes_commitment_from_booking() {
    let mut r = setup();
    let now = T0 + 100;
    let mut check: serde_json::Value = serde_json::from_slice(&check_json(22_000, 0, "non_refundable", now - 10)).unwrap();
    check["latest"] = serde_json::from_slice(&snap_json(22_000, now - 60, true)).unwrap();
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(serde_json::to_vec(&check).unwrap()),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let _ = r.on_drop_inputs(accounts(1), fk(), 5_000, None);
    let p = r.get_policy(r.next_policy_id - 1).unwrap();
    assert_eq!(p.passenger_commitment, PC);
}

fn back_fk() -> FlightKey {
    FlightKey { flight_number: "KL1700".into(), origin: "BCN".into(), destination: "AMS".into(), departure_date: "2027-01-31".into(), ..fk() }
}

fn route() -> RouteKey {
    RouteKey { origin: "AMS".into(), destination: "BCN".into(), departure_date: "2027-01-24".into(), fare_class: "economy_light".into() }
}

fn buy_purchase(r: &mut PolicyRegistry, now: u64, p: CapPurchase, prices: &[u64]) {
    let mut results: Vec<PromiseResult> = prices.iter().map(|x| PromiseResult::Successful(snap_json(*x, now - 60, true))).collect();
    results.push(PromiseResult::Successful(vault_json(10_000_000_000)));
    ctx("registry.test".parse().unwrap(), now, results);
    let _ = r.on_cap_inputs(accounts(1), p);
}

#[test]
fn seats_scale_premium_lock_exposure_and_payout() {
    let mut r = setup();
    let mut p = one_leg(fk(), 18_000, 30_000);
    p.seats = 3;
    buy_purchase(&mut r, T0 + 100, p, &[17_000]);
    let id = r.next_policy_id - 1;
    let pol = r.get_policy(id).unwrap();
    assert_eq!(pol.seats, 3);
    assert_eq!(pol.premium_minor % 3, 0, "premium is per traveller times seats");
    assert_eq!(pol.lock_usdc.0, 3 * 10_000 * 10_800);
    assert_eq!(r.get_flight_exposure(Product::Cap, pol.flight_key_hash).0, 30_000);
    activate(&mut r, id, T0 + 101);
    // Booking has only two of the three travellers: two seats are paid.
    let now = T0 + 100 + 2 * 86_400;
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json_for(&fk(), 25_500, 26_000, "non_refundable", now - 10, 2))]);
    let _ = r.on_cap_claim(id, fk());
    let pol = r.get_policy(id).unwrap();
    assert_eq!(pol.seats_covered, Some(2));
    assert_eq!(pol.payout_minor, Some(2 * 6_500));
    // Payout never exceeds the locked coverage.
    assert!(cents_to_usdc_floor(pol.payout_minor.unwrap(), pol.usdc_micro_per_cent) <= pol.lock_usdc.0);
}

#[test]
fn seat_count_is_bounded() {
    let mut r = setup();
    let mut p = one_leg(fk(), 18_000, 100_000);
    p.seats = 10;
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| buy_purchase(&mut r, T0 + 100, p, &[17_000])));
    assert!(res.is_err());
}

#[test]
fn return_trip_legs_share_a_trip_id() {
    let mut r = setup();
    let mut p = one_leg(fk(), 18_000, 5_000);
    p.legs.push(CapLeg { coverage: Coverage::Flight(back_fk()), strike_minor: 16_000, max_premium_minor: 5_000 });
    p.seats = 2;
    let first = r.next_policy_id;
    buy_purchase(&mut r, T0 + 100, p, &[17_000, 15_000]);
    assert_eq!(r.next_policy_id, first + 2);
    let out = r.get_policy(first).unwrap();
    let back = r.get_policy(first + 1).unwrap();
    assert_eq!(out.trip_id, Some(first));
    assert_eq!(back.trip_id, Some(first));
    assert_eq!(back.strike_minor, 16_000);
    assert_eq!(back.seats, 2);
    let credit = r.get_credit(accounts(1)).0;
    assert_eq!(credit, 50_000_000 - out.premium_usdc.0 - back.premium_usdc.0);
}

#[test]
fn return_trip_is_all_or_nothing() {
    let mut r = setup();
    let mut p = one_leg(fk(), 18_000, 5_000);
    // Return cap below the current return price: the second leg fails.
    p.legs.push(CapLeg { coverage: Coverage::Flight(back_fk()), strike_minor: 14_000, max_premium_minor: 5_000 });
    let first = r.next_policy_id;
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| buy_purchase(&mut r, T0 + 100, p, &[17_000, 15_000])));
    assert!(res.is_err());
    assert_eq!(r.next_policy_id, first, "no leg was recorded");
    assert_eq!(r.get_credit(accounts(1)).0, 50_000_000);
    assert!(r.get_policy(first).is_none());
}

#[test]
#[should_panic(expected = "the two legs must be different flights")]
fn return_trip_legs_must_differ() {
    let mut r = setup();
    let mut p = one_leg(fk(), 18_000, 5_000);
    p.legs.push(p.legs[0].clone());
    ctx(accounts(1), T0, vec![]);
    let _ = r.buy_caps(p);
}

#[test]
fn route_cap_pays_against_the_booked_flight_on_the_route() {
    let mut r = setup();
    let p = CapPurchase { legs: vec![CapLeg { coverage: Coverage::Route(route()), strike_minor: 18_000, max_premium_minor: 5_000 }], ..one_leg(fk(), 0, 0) };
    buy_purchase(&mut r, T0 + 100, p, &[17_000]);
    let id = r.next_policy_id - 1;
    let pol = r.get_policy(id).unwrap();
    assert_eq!(pol.flight_key_hash, route_key_hash(&route()));
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    // Any flight on the route works; the user names it.
    let other = FlightKey { airline: "VY".into(), flight_number: "VY8301".into(), ..fk() };
    ctx(accounts(1), now, vec![]);
    let _ = r.claim_cap(id, signed(&check_json_for(&other, 25_500, 0, "non_refundable", now - 10, 1)), Some(other.clone()));
    // Index is the route's cheapest fare at booking time (from the attestation registry).
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json_for(&other, 25_500, 23_000, "non_refundable", now - 10, 1))]);
    let _ = r.on_cap_claim(id, other.clone());
    let pol = r.get_policy(id).unwrap();
    assert_eq!(pol.booked_flight, Some(other.clone()));
    assert_eq!(pol.booked_flight_key_hash, Some(flight_key_hash(&other)));
    assert_eq!(pol.payout_minor, Some(23_000 - 18_000 - 1_000));
}

#[test]
#[should_panic(expected = "not on the covered route")]
fn route_cap_rejects_a_flight_on_another_day() {
    let mut r = setup();
    let p = CapPurchase { legs: vec![CapLeg { coverage: Coverage::Route(route()), strike_minor: 18_000, max_premium_minor: 5_000 }], ..one_leg(fk(), 0, 0) };
    buy_purchase(&mut r, T0 + 100, p, &[17_000]);
    let id = r.next_policy_id - 1;
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    let other = FlightKey { departure_date: "2027-01-25".into(), ..fk() };
    ctx(accounts(1), now, vec![]);
    let _ = r.claim_cap(id, signed(&check_json_for(&other, 25_500, 0, "non_refundable", now - 10, 1)), Some(other));
}

#[test]
#[should_panic(expected = "say which flight you booked")]
fn route_cap_needs_the_booked_flight() {
    let mut r = setup();
    let p = CapPurchase { legs: vec![CapLeg { coverage: Coverage::Route(route()), strike_minor: 18_000, max_premium_minor: 5_000 }], ..one_leg(fk(), 0, 0) };
    buy_purchase(&mut r, T0 + 100, p, &[17_000]);
    let id = r.next_policy_id - 1;
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    ctx(accounts(1), now, vec![]);
    let _ = r.claim_cap(id, signed(&check_json(25_500, 0, "non_refundable", now - 10)), None);
}

/// Cap bought with the Drop option, claimed at `now`; returns its id.
fn claimed_cap_with_drop_option(r: &mut PolicyRegistry, now: u64) -> u64 {
    let mut p = one_leg(fk(), 18_000, 5_000);
    p.auto_drop_max_premium_minor = Some(4_000);
    buy_purchase(r, T0 + 100, p, &[17_000]);
    let id = r.next_policy_id - 1;
    activate(r, id, T0 + 101);
    assert_eq!(r.get_policy(id).unwrap().auto_drop_max_premium_minor, Some(4_000));
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json(25_500, 26_000, "non_refundable", now - 10))]);
    let _ = r.on_cap_claim(id, fk());
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(b"true".to_vec())]);
    assert!(r.on_vault_resolved(id, PolicyState::PaidOut));
    id
}

#[test]
fn drop_after_claim_links_both_policies() {
    let mut r = setup();
    let now = T0 + 100 + 2 * 86_400;
    let cap = claimed_cap_with_drop_option(&mut r, now);
    let check = check_json(25_500, 0, "non_refundable", now - 10);
    // Entry checks pass for the same booking.
    ctx(accounts(1), now, vec![]);
    let _ = r.buy_drop(signed(&check), fk(), 4_000, Some(cap));
    // Callback: price still at what was paid.
    let mut c: serde_json::Value = serde_json::from_slice(&check).unwrap();
    c["latest"] = serde_json::from_slice(&snap_json(25_500, now - 60, true)).unwrap();
    ctx("registry.test".parse().unwrap(), now, vec![
        PromiseResult::Successful(serde_json::to_vec(&c).unwrap()),
        PromiseResult::Successful(vault_json(10_000_000_000)),
    ]);
    let _ = r.on_drop_inputs(accounts(1), fk(), 4_000, Some(cap));
    let drop_id = r.next_policy_id - 1;
    assert_eq!(r.get_policy(drop_id).unwrap().linked_policy, Some(cap));
    assert_eq!(r.get_policy(cap).unwrap().linked_policy, Some(drop_id));
    // If the vault refuses the drop, the link is undone.
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(b"\"0\"".to_vec())]);
    assert!(!r.on_policy_funded(drop_id));
    assert_eq!(r.get_policy(cap).unwrap().linked_policy, None);
}

#[test]
#[should_panic(expected = "not the one your Price Cap was claimed with")]
fn drop_after_claim_needs_the_same_booking() {
    let mut r = setup();
    let now = T0 + 100 + 2 * 86_400;
    let cap = claimed_cap_with_drop_option(&mut r, now);
    let mut a = signed(&check_json(25_500, 0, "non_refundable", now - 10));
    a.attestation.booking_ref_nullifier = Hash32([8; 32]);
    ctx(accounts(1), now, vec![]);
    let _ = r.buy_drop(a, fk(), 4_000, Some(cap));
}

#[test]
fn unconfirmed_held_claim_can_be_closed_after_departure() {
    let mut r = setup();
    let id = buy(&mut r, T0 + 100);
    activate(&mut r, id, T0 + 101);
    let now = T0 + 100 + 2 * 86_400;
    ctx("registry.test".parse().unwrap(), now, vec![PromiseResult::Successful(check_json(25_500, 26_000, "refundable", now - 10))]);
    let _ = r.on_cap_claim(id, fk());
    let p = r.get_policy(id).unwrap();
    assert_eq!(p.state, PolicyState::Claimed);
    // Too early: the user can still do the final check.
    ctx(accounts(4), p.departure_ts + 3_600, vec![]);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = r.void_unconfirmed_claim(id); }));
    assert!(early.is_err());
    // After departure + grace anyone can release the coverage.
    ctx(accounts(4), p.departure_ts + 3 * 86_400 + 1, vec![]);
    let _ = r.void_unconfirmed_claim(id);
    let held = r.get_policy(id).unwrap();
    assert!(held.busy);
    assert_eq!(held.payout_minor, Some(0));
    ctx("registry.test".parse().unwrap(), p.departure_ts + 3 * 86_400 + 2, vec![PromiseResult::Successful(b"true".to_vec())]);
    assert!(r.on_vault_resolved(id, PolicyState::Voided));
    assert_eq!(r.get_policy(id).unwrap().state, PolicyState::Voided);
    assert_eq!(r.get_flight_exposure(Product::Cap, p.flight_key_hash).0, 0);
}

#[test]
#[should_panic(expected = "no claim is waiting for a final check")]
fn paid_claims_cannot_be_voided() {
    let mut r = setup();
    let now = T0 + 100 + 2 * 86_400;
    let id = claimed_cap_with_drop_option(&mut r, now);
    ctx(accounts(4), now + 400 * 86_400, vec![]);
    let _ = r.void_unconfirmed_claim(id);
}
