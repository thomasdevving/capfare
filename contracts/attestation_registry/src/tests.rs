use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const T0: u64 = 1_800_000_000;

fn ctx(pred: AccountId, now: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("att.test".parse().unwrap())
        .predecessor_account_id(pred)
        .block_timestamp(now * 1_000_000_000);
    testing_env!(b.build());
}

const PC: Hash32 = Hash32([6u8; 32]);

fn registry() -> AccountId {
    "registry.test".parse().unwrap()
}

struct H {
    c: AttestationRegistry,
    oracle: SigningKey,
    verifier: SigningKey,
    m: Hash32,
}

fn setup(allow_demo: bool) -> H {
    near_sdk::mock::with_mocked_blockchain(|bc| {
        bc.take_storage();
    });
    ctx(accounts(0), T0);
    let mut c = AttestationRegistry::new(accounts(0), registry(), 3600, allow_demo, 7200);
    let oracle = SigningKey::from_bytes(&[7u8; 32]);
    let verifier = SigningKey::from_bytes(&[9u8; 32]);
    let m = Hash32([1u8; 32]);
    let opk = Hash32(oracle.verifying_key().to_bytes());
    let vpk = Hash32(verifier.verifying_key().to_bytes());
    c.propose_key(opk, ServiceKind::PriceOracle, m, Hash32([0u8; 32]));
    c.propose_key(vpk, ServiceKind::BookingVerifier, m, Hash32([0u8; 32]));
    ctx(accounts(3), T0 + 3600);
    c.apply_key(opk);
    c.apply_key(vpk);
    H { c, oracle, verifier, m }
}

fn fkh() -> Hash32 {
    Hash32([5u8; 32])
}

fn snap(h: &H, price: u64, at: u64, source: &str) -> SignedSnapshot {
    snap_for(h, fkh(), price, at, source)
}

fn snap_for(h: &H, key: Hash32, price: u64, at: u64, source: &str) -> SignedSnapshot {
    let s = PriceSnapshot {
        flight_key_hash: key,
        price_minor: price,
        currency: "EUR".into(),
        available: true,
        signals: Signals { momentum_bucket: 2, availability_bucket: 1, season_flag: false },
        departure_ts: T0 + 40 * 86_400,
        observed_at: at,
        source_id: source.into(),
        enclave_measurement: h.m,
    };
    let sig = h.oracle.sign(&snapshot_digest(&s));
    SignedSnapshot { snapshot: s, signer: Hash32(h.oracle.verifying_key().to_bytes()), signature: Sig64(sig.to_bytes()) }
}

fn att(h: &H, booked_at: u64, verified_at: u64, n: u8) -> SignedBookingAttestation {
    let a = BookingAttestation {
        flight_key_hash: fkh(),
        paid_price_minor: 25_500,
        currency: "EUR".into(),
        fare_class: "economy_light".into(),
        refundable: Refundability::NonRefundable,
        booking_ref_nullifier: Hash32([n; 32]),
        status: BookingStatus::Active,
        method: VerificationMethod::DkimEml,
        booked_at,
        verified_at,
        enclave_measurement: h.m,
        passenger_commitment: PC,
        seats: 1,
    };
    let sig = h.verifier.sign(&attestation_digest(&a));
    SignedBookingAttestation { attestation: a, signer: Hash32(h.verifier.verifying_key().to_bytes()), signature: Sig64(sig.to_bytes()) }
}

#[test]
#[should_panic(expected = "timelock has not passed")]
fn key_needs_timelock() {
    near_sdk::mock::with_mocked_blockchain(|bc| {
        bc.take_storage();
    });
    ctx(accounts(0), T0);
    let mut c = AttestationRegistry::new(accounts(0), registry(), 3600, false, 7200);
    c.propose_key(Hash32([2; 32]), ServiceKind::PriceOracle, Hash32([1; 32]), Hash32([0; 32]));
    ctx(accounts(0), T0 + 10);
    c.apply_key(Hash32([2; 32]));
}

#[test]
fn accepts_valid_and_rejects_forged_stale_future_demo() {
    let mut h = setup(false);
    let now = T0 + 4000;
    ctx(accounts(3), now);
    let good = snap(&h, 17_000, now - 10, "klm.com");
    let mut forged = snap(&h, 9_000, now - 5, "klm.com");
    forged.snapshot.price_minor = 1; // signature no longer matches
    let stale = snap(&h, 17_000, now - 9_000, "klm.com");
    let future = snap(&h, 17_000, now + 1_000, "klm.com");
    let demo = snap(&h, 17_000, now - 1, "demo");
    let r = h.c.submit_snapshots(vec![good, forged, stale, future, demo]);
    assert_eq!(r, vec!["ok", "bad signature", "stale snapshot", "snapshot from the future", "demo snapshots are not accepted on this deployment"]);
    assert_eq!(h.c.get_latest_snapshot(fkh()).unwrap().price_minor, 17_000);
    // Replay of the same snapshot is rejected (not newer).
    let again = snap(&h, 17_000, now - 10, "klm.com");
    assert_eq!(h.c.submit_snapshots(vec![again]), vec!["not newer than the latest snapshot"]);
}

#[test]
fn wrong_measurement_and_revoked_key_rejected() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(3), now);
    let mut s = snap(&h, 17_000, now, "demo");
    s.snapshot.enclave_measurement = Hash32([2; 32]);
    let sig = h.oracle.sign(&snapshot_digest(&s.snapshot));
    s.signature = Sig64(sig.to_bytes());
    assert_eq!(h.c.submit_snapshots(vec![s]), vec!["enclave measurement mismatch"]);
    ctx(accounts(0), now);
    h.c.revoke_key(Hash32(h.oracle.verifying_key().to_bytes()));
    let s = snap(&h, 17_000, now, "demo");
    assert_eq!(h.c.submit_snapshots(vec![s]), vec!["signer revoked"]);
}

#[test]
fn verifier_key_cannot_sign_snapshots() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(3), now);
    let mut s = snap(&h, 17_000, now, "demo");
    s.signer = Hash32(h.verifier.verifying_key().to_bytes());
    s.signature = Sig64(h.verifier.sign(&snapshot_digest(&s.snapshot)).to_bytes());
    assert_eq!(h.c.submit_snapshots(vec![s]), vec!["signer registered for another service"]);
}

#[test]
fn index_and_lowest_price() {
    let mut h = setup(true);
    let base = T0 + 4000;
    for (i, p) in [17_000u64, 19_000, 26_000, 24_000].iter().enumerate() {
        let t = base + i as u64 * 3600;
        ctx(accounts(3), t);
        assert_eq!(h.c.submit_snapshots(vec![snap(&h, *p, t, "demo")]), vec!["ok"]);
    }
    // Booked 30 min after the 26_000 snapshot -> index 26_000.
    assert_eq!(h.c.index_price_at(fkh(), base + 2 * 3600 + 1800, 6 * 3600), Some(26_000));
    // Too old index -> None.
    assert_eq!(h.c.index_price_at(fkh(), base + 3 * 3600 + 7 * 3600, 6 * 3600), None);
    // Before any snapshot -> None.
    assert_eq!(h.c.index_price_at(fkh(), base - 1, 6 * 3600), None);
    assert_eq!(h.c.lowest_price_between(fkh(), base + 3600, base + 3 * 3600), Some(19_000));
    assert_eq!(h.c.lowest_price_between(fkh(), base, base + 10 * 3600), Some(17_000));
}

#[test]
fn nullifier_is_single_use_per_product() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(3), now - 200);
    assert_eq!(h.c.submit_snapshots(vec![snap(&h, 26_000, now - 200, "demo")]), vec!["ok"]);
    ctx(registry(), now);
    let a = att(&h, now - 100, now - 10, 4);
    h.c.consume_booking(a.clone(), Product::Cap, 3600, 6 * 3600, None);
    assert!(h.c.is_nullifier_used(Product::Cap, Hash32([4; 32]), fkh()));
    assert!(!h.c.is_nullifier_used(Product::Drop, Hash32([4; 32]), fkh()));
    // Drop can still use the same booking once.
    h.c.consume_booking(a.clone(), Product::Drop, 3600, 6 * 3600, None);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.c.consume_booking(a.clone(), Product::Cap, 3600, 6 * 3600, None);
    }));
    assert!(r.is_err(), "double claim must be rejected");
}

#[test]
fn cap_claim_needs_an_index_price() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(registry(), now);
    let a = att(&h, now - 100, now - 10, 4);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.c.consume_booking(a.clone(), Product::Cap, 3600, 6 * 3600, None);
    }));
    assert!(r.is_err());
    assert!(!h.c.is_nullifier_used(Product::Cap, Hash32([4; 32]), fkh()));
}

#[test]
#[should_panic(expected = "only the policy registry")]
fn only_registry_consumes() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(4), now);
    let a = att(&h, now - 100, now - 10, 4);
    h.c.consume_booking(a, Product::Cap, 3600, 6 * 3600, None);
}

#[test]
#[should_panic(expected = "stale attestation")]
fn stale_attestation_rejected() {
    let mut h = setup(true);
    let now = T0 + 40_000;
    ctx(registry(), now);
    let a = att(&h, now - 10_000, now - 7200, 4);
    h.c.consume_booking(a, Product::Cap, 3600, 6 * 3600, None);
}

#[test]
#[should_panic(expected = "bad signature")]
fn forged_attestation_rejected() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(registry(), now);
    let mut a = att(&h, now - 100, now - 10, 4);
    a.attestation.paid_price_minor = 99_999;
    h.c.consume_booking(a, Product::Cap, 3600, 6 * 3600, None);
}

#[test]
fn status_check_binds_to_booking() {
    let h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(4), now);
    let a = att(&h, now - 100, now - 10, 4);
    let r = h.c.check_status(a.clone(), Hash32([4; 32]), fkh(), PC, false, now - 60, 3600, None, None);
    assert_eq!(r.status, BookingStatus::Active);
    let bad = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.c.check_status(a.clone(), Hash32([8; 32]), fkh(), PC, false, 0, 3600, None, None);
    }));
    assert!(bad.is_err());
    // Another passenger's booking is rejected.
    let other = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.c.check_status(a.clone(), Hash32([4; 32]), fkh(), Hash32([7; 32]), false, 0, 3600, None, None);
    }));
    assert!(other.is_err());
}

#[test]
#[should_panic(expected = "refundable tickets need a live check")]
fn email_is_not_a_live_check() {
    let h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(4), now);
    let a = att(&h, now - 100, now - 10, 4); // method DkimEml
    h.c.check_status(a, Hash32([4; 32]), fkh(), PC, true, 0, 3600, None, None);
}

#[test]
fn tls_page_is_a_live_check() {
    let h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(4), now);
    let mut a = att(&h, now - 100, now - 10, 4);
    a.attestation.method = VerificationMethod::TlsPage;
    a.signature = Sig64(h.verifier.sign(&attestation_digest(&a.attestation)).to_bytes());
    let r = h.c.check_status(a, Hash32([4; 32]), fkh(), PC, true, 0, 3600, None, None);
    assert_eq!(r.status, BookingStatus::Active);
}

fn resign(h: &H, a: &mut SignedBookingAttestation) {
    a.signature = Sig64(h.verifier.sign(&attestation_digest(&a.attestation)).to_bytes());
}

#[test]
fn each_leg_of_a_return_booking_is_used_once() {
    let mut h = setup(true);
    let now = T0 + 4000;
    let back = Hash32([15u8; 32]);
    ctx(accounts(3), now - 200);
    assert_eq!(h.c.submit_snapshots(vec![snap(&h, 26_000, now - 200, "demo"), snap_for(&h, back, 24_000, now - 200, "demo")]), vec!["ok", "ok"]);
    ctx(registry(), now);
    let out = att(&h, now - 100, now - 10, 4);
    let mut ret = out.clone();
    ret.attestation.flight_key_hash = back;
    resign(&h, &mut ret);
    // Same booking reference, two flights: both legs can be claimed.
    assert_eq!(h.c.consume_booking(out.clone(), Product::Cap, 3600, 6 * 3600, None).index_price, Some(26_000));
    assert_eq!(h.c.consume_booking(ret.clone(), Product::Cap, 3600, 6 * 3600, None).index_price, Some(24_000));
    assert!(h.c.is_nullifier_used(Product::Cap, Hash32([4; 32]), back));
    // But neither leg twice.
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.c.consume_booking(ret.clone(), Product::Cap, 3600, 6 * 3600, None);
    }));
    assert!(again.is_err());
    // Releasing one leg does not release the other.
    h.c.release_nullifier(Product::Cap, Hash32([4; 32]), back);
    assert!(!h.c.is_nullifier_used(Product::Cap, Hash32([4; 32]), back));
    assert!(h.c.is_nullifier_used(Product::Cap, Hash32([4; 32]), fkh()));
}

#[test]
fn route_coverage_uses_the_route_index() {
    let mut h = setup(true);
    let now = T0 + 4000;
    let route = Hash32([33u8; 32]);
    ctx(accounts(3), now - 200);
    // The booked flight costs 26_000 but the cheapest flight on the route was 21_000.
    h.c.submit_snapshots(vec![snap(&h, 26_000, now - 200, "demo"), snap_for(&h, route, 21_000, now - 200, "demo")]);
    ctx(registry(), now);
    let a = att(&h, now - 100, now - 10, 4);
    assert_eq!(h.c.consume_booking(a, Product::Cap, 3600, 6 * 3600, Some(route)).index_price, Some(21_000));
}

#[test]
#[should_panic(expected = "number of travellers out of range")]
fn seats_must_be_in_range() {
    let mut h = setup(true);
    let now = T0 + 4000;
    ctx(accounts(3), now - 200);
    h.c.submit_snapshots(vec![snap(&h, 26_000, now - 200, "demo")]);
    ctx(registry(), now);
    let mut a = att(&h, now - 100, now - 10, 4);
    a.attestation.seats = 0;
    resign(&h, &mut a);
    h.c.consume_booking(a, Product::Cap, 3600, 6 * 3600, None);
}
