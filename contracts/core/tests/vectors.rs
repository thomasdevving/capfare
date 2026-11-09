//! Generates the cross-language conformance vectors used by /shared (TS) and
//! /backtest (Python):  cargo test -p capfare-core --test vectors -- --ignored
//! The non-ignored test verifies the committed file is up to date.

use capfare_core::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};

fn rng(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}

fn build() -> Value {
    let params = Params::example();
    let keys = vec![
        FlightKey { airline: "KL".into(), flight_number: "KL1695".into(), departure_date: "2027-06-14".into(), origin: "AMS".into(), destination: "BCN".into(), fare_class: "economy_light".into() },
        FlightKey { airline: "HV".into(), flight_number: "HV5131".into(), departure_date: "2027-01-03".into(), origin: "RTM".into(), destination: "AGP".into(), fare_class: "economy_standard".into() },
    ];
    let fk: Vec<Value> = keys.iter().map(|k| json!({"flight_key": k, "hash": flight_key_hash(k)})).collect();
    let snap = PriceSnapshot {
        flight_key_hash: flight_key_hash(&keys[0]), price_minor: 17_000, currency: "EUR".into(), available: true,
        signals: Signals { momentum_bucket: 3, availability_bucket: 1, season_flag: true },
        departure_ts: 1_812_700_000, observed_at: 1_810_000_000, source_id: "demo".into(), enclave_measurement: Hash32([0xab; 32]),
    };
    let att = BookingAttestation {
        flight_key_hash: flight_key_hash(&keys[0]), paid_price_minor: 25_500, currency: "EUR".into(), fare_class: "economy_light".into(),
        refundable: Refundability::Unknown, booking_ref_nullifier: Hash32([0x11; 32]), status: BookingStatus::Active,
        method: VerificationMethod::TlsPage, booked_at: 1_810_000_100, verified_at: 1_810_000_200, enclave_measurement: Hash32([0xab; 32]),
        passenger_commitment: Hash32([0x22; 32]),
        seats: 3,
    };
    let route = RouteKey { origin: "AMS".into(), destination: "BCN".into(), departure_date: "2027-06-14".into(), fare_class: "economy_light".into() };
    let coverages: Vec<Value> = [Coverage::Flight(keys[0].clone()), Coverage::Route(route.clone())]
        .iter()
        .map(|c| json!({"coverage": c, "hash": coverage_hash(c)}))
        .collect();
    let leg = json!({
        "booking_nullifier": Hash32([0x11; 32]),
        "flight_key_hash": flight_key_hash(&keys[0]),
        "leg_nullifier": leg_nullifier(&Hash32([0x11; 32]), &flight_key_hash(&keys[0])),
    });
    let mut seed = 0x9e3779b97f4a7c15u64;
    let mut premiums = vec![];
    for i in 0..60 {
        let product = if i % 3 == 0 { Product::Drop } else { Product::Cap };
        let price = 3_000 + rng(&mut seed) % 60_000;
        let strike = if product == Product::Cap { price + rng(&mut seed) % 15_000 } else { price };
        let now = 1_800_000_000u64;
        let inputs = PremiumInputs {
            product, current_price: price, strike,
            signals: Signals { momentum_bucket: (rng(&mut seed) % 5) as u8, availability_bucket: (rng(&mut seed) % 5) as u8, season_flag: rng(&mut seed) % 2 == 0 },
            now, departure_ts: now + 2 * 86_400 + rng(&mut seed) % (120 * 86_400),
            vault_total_assets: U128(1_000_000_000 + (rng(&mut seed) % 9_000_000_000) as u128),
            vault_locked: U128((rng(&mut seed) % 900_000_000) as u128),
            vault_reserved: U128((rng(&mut seed) % 100_000_000) as u128),
            new_lock: U128(108_000_000),
            flight_exposure: rng(&mut seed) % 1_500_000,
        };
        let out = compute_premium(params.product(product), &inputs).unwrap();
        premiums.push(json!({"inputs": inputs, "premium": out.premium, "unclamped": out.unclamped}));
    }
    let payouts: Vec<Value> = [(26_000u64, 25_500u64, 18_000u64), (17_000, 17_500, 18_000), (40_000, 39_000, 20_000)]
        .iter()
        .map(|(i, p, k)| json!({"index": i, "paid": p, "strike": k, "deductible": 1_000, "max_payout": 10_000, "payout": cap_payout(*i, *p, *k, 1_000, 10_000)}))
        .collect();
    json!({
        "params": params,
        "flight_keys": fk,
        "snapshot": {"value": snap, "borsh_hex": hex::encode(near_sdk::borsh::to_vec(&snap).unwrap()), "digest": hex::encode(snapshot_digest(&snap))},
        "attestation": {"value": att, "borsh_hex": hex::encode(near_sdk::borsh::to_vec(&att).unwrap()), "digest": hex::encode(attestation_digest(&att))},
        "route_key": {"value": route, "hash": route_key_hash(&route)},
        "coverages": coverages,
        "leg_nullifier": leg,
        "route_week": {"origin": "AMS", "destination": "BCN", "departure_ts": 1_812_700_000u64, "key": route_week_key("AMS", "BCN", 1_812_700_000)},
        "premiums": premiums,
        "cap_payouts": payouts,
    })
}

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/test-vectors/vectors.json");

#[test]
#[ignore]
fn gen_vectors() {
    std::fs::write(PATH, serde_json::to_string_pretty(&build()).unwrap()).unwrap();
}

#[test]
fn vectors_up_to_date() {
    let on_disk: Value = serde_json::from_str(&std::fs::read_to_string(PATH).expect("run gen_vectors")).unwrap();
    assert_eq!(on_disk, build(), "shared/test-vectors/vectors.json is stale: run gen_vectors");
}

#[test]
fn exported_backtest_params_are_valid() {
    for f in ["premium_params.json", "demo_params.json"] {
        let path = format!("{}/../../backtest/output/{f}", env!("CARGO_MANIFEST_DIR"));
        let Ok(s) = std::fs::read_to_string(&path) else { continue };
        let mut v: Value = serde_json::from_str(&s).unwrap();
        v.as_object_mut().unwrap().remove("_meta");
        let p: Params = serde_json::from_value(v).unwrap_or_else(|e| panic!("{f}: {e}"));
        p.validate().unwrap_or_else(|e| panic!("{f}: {e}"));
    }
}
