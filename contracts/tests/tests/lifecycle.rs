//! Sandbox integration tests: full lifecycles of both products and forced
//! failures in every value-moving cross-contract callback.
//!
//! Requires the wasm files: run `make contracts` (or `scripts/build-contracts.sh`) first.

use capfare_core::*;
use ed25519_dalek::{Signer as _, SigningKey};
use near_api::types::{AccountId, Data, NearToken};
use near_api::{Chain, Contract, NetworkConfig, Signer};
use near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY;
use near_sandbox::Sandbox;
use serde_json::{json, Value};
use std::sync::Arc;

type R<T> = anyhow::Result<T>;

fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}; run `make contracts` first"))
}

const M: [u8; 32] = [1u8; 32];
const PC: [u8; 32] = [6u8; 32];
const USDC: u128 = 1_000_000;

struct Env {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    usdc: AccountId,
    att: AccountId,
    reg: AccountId,
    cap: AccountId,
    drop: AccountId,
    lp: AccountId,
    alice: AccountId,
    bob: AccountId,
    oracle: SigningKey,
    verifier: SigningKey,
}

fn test_params() -> Params {
    let mut p = Params::example();
    p.global.param_timelock_secs = 5;
    p.global.claim_grace_secs = 3_600;
    p.cap.activation_delay_secs = 4;
    p.cap.validity_secs = 3_600;
    p.drop.validity_secs = 12;
    p.cap.min_secs_before_departure = 3_600;
    p.drop.min_secs_before_departure = 3_600;
    p
}

fn flight() -> FlightKey {
    FlightKey {
        airline: "KL".into(),
        flight_number: "KL1695".into(),
        departure_date: "2027-06-14".into(),
        origin: "AMS".into(),
        destination: "BCN".into(),
        fare_class: "economy_light".into(),
    }
}

impl Env {
    async fn new() -> R<Self> {
        let sandbox = Sandbox::start_sandbox().await?;
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
        let id = |s: &str| -> AccountId { s.parse().unwrap() };
        let (usdc, att, reg, cap, drop) = (id("usdc.sandbox"), id("att.sandbox"), id("registry.sandbox"), id("cap.sandbox"), id("drop.sandbox"));
        let (lp, alice, bob, fee) = (id("lp.sandbox"), id("alice.sandbox"), id("bob.sandbox"), id("fee.sandbox"));
        for a in [&usdc, &att, &reg, &cap, &drop, &lp, &alice, &bob, &fee] {
            sandbox.create_account(a.as_str().parse()?).initial_balance(NearToken::from_near(100)).send().await?;
        }
        let e = Env {
            _sandbox: sandbox,
            net,
            signer,
            usdc: usdc.clone(),
            att: att.clone(),
            reg: reg.clone(),
            cap: cap.clone(),
            drop: drop.clone(),
            lp,
            alice,
            bob,
            oracle: SigningKey::from_bytes(&[7u8; 32]),
            verifier: SigningKey::from_bytes(&[9u8; 32]),
        };
        let owner = id("sandbox");
        e.deploy(&usdc, "capfare_mock_ft", json!({"owner": owner, "faucet_amount": "0"})).await?;
        e.deploy(&att, "capfare_attestation_registry", json!({"owner": owner, "registry": reg, "key_timelock_secs": 0, "allow_demo_sources": true, "max_snapshot_submit_age_secs": 7200})).await?;
        for (v, name) in [(&cap, "cap_vault"), (&drop, "drop_vault")] {
            e.deploy(v, "capfare_vault", json!({"owner": owner, "name": name, "token": usdc, "registry": reg, "fee_account": fee, "epoch_secs": 1, "min_deposit": "1000000"})).await?;
        }
        e.deploy(&reg, "capfare_policy_registry", json!({"owner": owner, "token": usdc, "attestation": att, "cap_vault": cap, "drop_vault": drop, "params": test_params()})).await?;
        // Token registrations + balances.
        for a in [&att, &reg, &cap, &drop, &e.lp, &e.alice, &e.bob, &fee] {
            e.mint(a, 0).await?;
        }
        e.mint(&e.lp, 10_000 * USDC).await?;
        e.mint(&e.alice, 100 * USDC).await?;
        e.mint(&e.bob, 100 * USDC).await?;
        // Enclave keys (timelock 0 in tests).
        for (k, svc) in [(&e.oracle, "price_oracle"), (&e.verifier, "booking_verifier")] {
            let pk = Hash32(k.verifying_key().to_bytes());
            e.ok(&owner, &att, "propose_key", json!({"public_key": pk, "service": svc, "measurement": Hash32(M), "report_hash": Hash32([0; 32])})).await?;
            e.ok(&owner, &att, "apply_key", json!({"public_key": pk})).await?;
        }
        // Seed both vaults: deposit then roll the epoch.
        for v in [&cap, &drop] {
            e.ft_call(&e.lp, v, 2_000 * USDC, "\"deposit\"").await?;
        }
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        for v in [&cap, &drop] {
            e.ok(&e.lp, v, "roll_epoch", json!({})).await?;
        }
        Ok(e)
    }

    async fn deploy(&self, who: &AccountId, name: &str, init: Value) -> R<()> {
        Contract::deploy(who.clone())
            .use_code(wasm(name))
            .with_init_call("new", init)?
            .with_signer(self.signer.clone())
            .send_to(&self.net)
            .await?
            .assert_success();
        Ok(())
    }

    async fn call(&self, signer: &AccountId, contract: &AccountId, method: &str, args: Value, deposit: u128) -> R<near_api::types::transaction::result::TransactionResult> {
        Ok(Contract(contract.clone())
            .call_function(method, args)
            .transaction()
            .gas(near_api::types::NearGas::from_tgas(300))
            .deposit(NearToken::from_yoctonear(deposit))
            .with_signer(signer.clone(), self.signer.clone())
            .send_to(&self.net)
            .await?)
    }

    async fn ok(&self, signer: &AccountId, contract: &AccountId, method: &str, args: Value) -> R<()> {
        let r = self.call(signer, contract, method, args, 0).await?;
        assert!(r.is_success(), "{method} failed: {:?}", r);
        Ok(())
    }

    async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(&self, contract: &AccountId, method: &str, args: Value) -> R<T> {
        let d: Data<T> = Contract(contract.clone()).call_function(method, args).read_only().fetch_from(&self.net).await?;
        Ok(d.data)
    }

    async fn mint(&self, to: &AccountId, amount: u128) -> R<()> {
        let owner: AccountId = "sandbox".parse()?;
        self.ok(&owner, &self.usdc, "mint", json!({"account_id": to, "amount": amount.to_string()})).await
    }

    async fn ft_call(&self, from: &AccountId, to: &AccountId, amount: u128, msg: &str) -> R<()> {
        let r = self
            .call(from, &self.usdc, "ft_transfer_call", json!({"receiver_id": to, "amount": amount.to_string(), "msg": msg}), 1)
            .await?;
        assert!(r.is_success(), "ft_transfer_call failed: {:?}", r);
        Ok(())
    }

    async fn balance(&self, a: &AccountId) -> R<u128> {
        let s: String = self.view(&self.usdc, "ft_balance_of", json!({"account_id": a})).await?;
        Ok(s.parse()?)
    }

    async fn now(&self) -> R<u64> {
        let b = Chain::block().fetch_from(&self.net).await?;
        Ok(b.header.timestamp / 1_000_000_000)
    }

    fn sign_snapshot(&self, price: u64, observed_at: u64, available: bool) -> SignedSnapshot {
        let s = PriceSnapshot {
            flight_key_hash: flight_key_hash(&flight()),
            price_minor: price,
            currency: "EUR".into(),
            available,
            signals: Signals { momentum_bucket: 2, availability_bucket: 1, season_flag: false },
            departure_ts: observed_at + 30 * 86_400,
            observed_at,
            source_id: "demo".into(),
            enclave_measurement: Hash32(M),
        };
        let sig = self.oracle.sign(&snapshot_digest(&s));
        SignedSnapshot { snapshot: s, signer: Hash32(self.oracle.verifying_key().to_bytes()), signature: Sig64(sig.to_bytes()) }
    }

    async fn push_price(&self, price: u64) -> R<()> {
        self.push_price_avail(price, true).await
    }

    async fn push_price_avail(&self, price: u64, available: bool) -> R<()> {
        let now = self.now().await?;
        let s = self.sign_snapshot(price, now, available);
        let r: Vec<String> = self.call(&self.lp, &self.att, "submit_snapshots", json!({"snapshots": [s]}), 0).await?.into_full().expect("final").json()?;
        assert_eq!(r, vec!["ok".to_string()]);
        // Make sure later snapshots get a strictly newer timestamp.
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn sign_att(&self, paid: u64, refundable: Refundability, status: BookingStatus, nullifier: u8, booked_at: u64, verified_at: u64) -> SignedBookingAttestation {
        let a = BookingAttestation {
            flight_key_hash: flight_key_hash(&flight()),
            paid_price_minor: paid,
            currency: "EUR".into(),
            fare_class: "economy_light".into(),
            refundable,
            booking_ref_nullifier: Hash32([nullifier; 32]),
            status,
            method: VerificationMethod::DkimEml,
            booked_at,
            verified_at,
            enclave_measurement: Hash32(M),
            passenger_commitment: Hash32(PC),
        };
        let sig = self.verifier.sign(&attestation_digest(&a));
        SignedBookingAttestation { attestation: a, signer: Hash32(self.verifier.verifying_key().to_bytes()), signature: Sig64(sig.to_bytes()) }
    }

    async fn policy(&self, id: u64) -> R<Value> {
        self.view(&self.reg, "get_policy", json!({"policy_id": id})).await
    }

    async fn vault(&self, v: &AccountId) -> R<Value> {
        self.view(v, "get_state", json!({})).await
    }

    /// Invariant + accounting identity for both vaults and the registry.
    async fn check_books(&self) -> R<()> {
        for v in [&self.cap, &self.drop] {
            let s = self.vault(v).await?;
            assert_eq!(s["invariant_ok"], true, "{v} invariant: {s}");
            let expected: String = self.view(v, "get_expected_token_balance", json!({})).await?;
            assert_eq!(expected.parse::<u128>()?, self.balance(v).await?, "{v} accounting identity: {s}");
            assert_eq!(s["in_flight"], "0");
        }
        let expected: String = self.view(&self.reg, "get_expected_token_balance", json!({})).await?;
        assert_eq!(expected.parse::<u128>()?, self.balance(&self.reg).await?, "registry accounting identity");
        Ok(())
    }

    async fn buy_cap(&self, who: &AccountId, strike: u64) -> R<u64> {
        let stats: Value = self.view(&self.reg, "get_stats", json!({})).await?;
        let id = stats["policies_total"].as_u64().unwrap() + 1;
        let r = self.call(who, &self.reg, "buy_cap", json!({"flight_key": flight(), "strike_minor": strike, "max_premium_minor": 5_000, "passenger_commitment": Hash32(PC)}), 0).await?;
        assert!(r.is_success(), "buy_cap: {r:?}");
        Ok(id)
    }

    async fn set_blocked(&self, a: &AccountId, blocked: bool) -> R<()> {
        let owner: AccountId = "sandbox".parse()?;
        self.ok(&owner, &self.usdc, "set_blocked", json!({"account_id": a, "blocked": blocked})).await
    }
}

#[tokio::test]
async fn full_lifecycles_and_forced_failures() -> R<()> {
    let e = Env::new().await?;
    e.check_books().await?;

    // ---------------------------------------------------------- Price Cap demo
    e.ft_call(&e.alice, &e.reg, 60 * USDC, "\"top_up\"").await?;
    e.push_price(17_000).await?;
    let id = e.buy_cap(&e.alice, 18_000).await?;
    let p = e.policy(id).await?;
    assert_eq!(p["state"], "active", "{p}");
    let lock: u128 = p["lock_usdc"].as_str().unwrap().parse()?;
    assert_eq!(lock, 10_000 * 10_800);
    let vs = e.vault(&e.cap).await?;
    assert_eq!(vs["locked_coverage"], lock.to_string());
    e.check_books().await?;

    // Booking before activation is rejected.
    let now = e.now().await?;
    let early = e.sign_att(25_500, Refundability::NonRefundable, BookingStatus::Active, 11, now, now);
    let r = e.call(&e.alice, &e.reg, "claim_cap", json!({"policy_id": id, "attestation": early}), 0).await?;
    assert!(!r.is_success());

    // Past the activation delay the price rises to 260; booked at 255.
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    e.push_price(26_000).await?;
    let now = e.now().await?;
    let a = e.sign_att(25_500, Refundability::NonRefundable, BookingStatus::Active, 11, now - 1, now);
    let before = e.balance(&e.alice).await?;
    e.ok(&e.alice, &e.reg, "claim_cap", json!({"policy_id": id, "attestation": a})).await?;
    let p = e.policy(id).await?;
    assert_eq!(p["state"], "paid_out", "{p}");
    assert_eq!(p["payout_minor"], 6_500);
    assert_eq!(e.balance(&e.alice).await? - before, 6_500 * 10_800);
    assert_eq!(e.vault(&e.cap).await?["locked_coverage"], "0");
    e.check_books().await?;

    // ---------------------------------------- double claim with the same booking
    e.push_price(26_000).await?;
    let id2 = e.buy_cap(&e.alice, 27_000).await?;
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    e.push_price(30_000).await?;
    let now = e.now().await?;
    let reused = e.sign_att(25_500, Refundability::NonRefundable, BookingStatus::Active, 11, now - 1, now);
    e.ok(&e.alice, &e.reg, "claim_cap", json!({"policy_id": id2, "attestation": reused})).await?;
    let p2 = e.policy(id2).await?;
    assert_eq!(p2["state"], "active", "double claim must be rejected: {p2}");
    assert_eq!(p2["busy"], false);

    // ------------------------------------- forged attestation rejected on claim
    let mut forged = e.sign_att(28_000, Refundability::NonRefundable, BookingStatus::Active, 12, now - 1, now);
    forged.attestation.paid_price_minor = 99_000;
    e.ok(&e.alice, &e.reg, "claim_cap", json!({"policy_id": id2, "attestation": forged})).await?;
    assert_eq!(e.policy(id2).await?["state"], "active");

    // ------------------- payout transfer fails -> vault rolls back -> retry works
    e.set_blocked(&e.alice, true).await?;
    let now = e.now().await?;
    let a = e.sign_att(29_500, Refundability::NonRefundable, BookingStatus::Active, 13, now - 1, now);
    let locked_before = e.vault(&e.cap).await?["locked_coverage"].clone();
    e.ok(&e.alice, &e.reg, "claim_cap", json!({"policy_id": id2, "attestation": a})).await?;
    let p2 = e.policy(id2).await?;
    assert_eq!(p2["state"], "claimed", "{p2}");
    assert_eq!(e.vault(&e.cap).await?["locked_coverage"], locked_before, "lock restored after failed transfer");
    e.check_books().await?;
    e.set_blocked(&e.alice, false).await?;
    e.ok(&e.bob, &e.reg, "retry_payout", json!({"policy_id": id2})).await?;
    assert_eq!(e.policy(id2).await?["state"], "paid_out");
    e.check_books().await?;

    // ---------- premium transfer to vault fails -> credit restored, policy voided
    e.ft_call(&e.bob, &e.reg, 20 * USDC, "\"top_up\"").await?;
    e.push_price(17_500).await?;
    e.set_blocked(&e.cap, true).await?;
    let credit_before: String = e.view(&e.reg, "get_credit", json!({"account_id": e.bob})).await?;
    let id3 = e.buy_cap(&e.bob, 18_000).await?;
    let p3 = e.policy(id3).await?;
    assert_eq!(p3["state"], "voided", "{p3}");
    let credit_after: String = e.view(&e.reg, "get_credit", json!({"account_id": e.bob})).await?;
    assert_eq!(credit_before, credit_after);
    e.set_blocked(&e.cap, false).await?;
    e.check_books().await?;

    // ------------------------------------------- sold-out refund to credit
    let id4 = e.buy_cap(&e.bob, 18_000).await?;
    assert_eq!(e.policy(id4).await?["state"], "active");
    e.push_price_avail(19_000, false).await?;
    e.ok(&e.bob, &e.reg, "refund_sold_out", json!({"policy_id": id4})).await?;
    assert_eq!(e.policy(id4).await?["state"], "refunded");
    let credit_final: String = e.view(&e.reg, "get_credit", json!({"account_id": e.bob})).await?;
    assert_eq!(credit_final, credit_before);
    e.check_books().await?;

    // ---------------------------------------------------- Drop Guarantee demo
    e.push_price(22_000).await?;
    let now = e.now().await?;
    let booking = e.sign_att(22_000, Refundability::NonRefundable, BookingStatus::Active, 21, now - 60, now);
    let stats: Value = e.view(&e.reg, "get_stats", json!({})).await?;
    let did = stats["policies_total"].as_u64().unwrap() + 1;
    e.ok(&e.alice, &e.reg, "buy_drop", json!({"attestation": booking, "flight_key": flight(), "max_premium_minor": 5_000})).await?;
    let d = e.policy(did).await?;
    assert_eq!(d["state"], "active", "{d}");
    assert_eq!(d["strike_minor"], 22_000);
    for p in [21_000, 19_500, 20_500] {
        e.push_price(p).await?;
    }
    let exp = d["expires_at"].as_u64().unwrap();
    while e.now().await? < exp + 1 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    let now = e.now().await?;
    let status = e.sign_att(22_000, Refundability::NonRefundable, BookingStatus::Active, 21, now - 60, now);
    let before = e.balance(&e.alice).await?;
    e.ok(&e.bob, &e.reg, "settle_drop", json!({"policy_id": did, "attestation": status})).await?;
    let d = e.policy(did).await?;
    assert_eq!(d["state"], "paid_out", "{d}");
    assert_eq!(d["lowest_price_seen_minor"], 19_500);
    assert_eq!(d["payout_minor"], 2_000);
    assert_eq!(e.balance(&e.alice).await? - before, 2_000 * 10_800);
    e.check_books().await?;

    // ------------- drop purchase refused after the price already dropped:
    // nullifier is released so the booking can be used again later.
    e.push_price(19_000).await?;
    let now = e.now().await?;
    let booking = e.sign_att(22_000, Refundability::NonRefundable, BookingStatus::Active, 22, now - 60, now);
    e.call(&e.alice, &e.reg, "buy_drop", json!({"attestation": booking, "flight_key": flight(), "max_premium_minor": 5_000}), 0).await?;
    let used: bool = e.view(&e.att, "is_nullifier_used", json!({"product": "drop", "nullifier": Hash32([22; 32])})).await?;
    assert!(!used, "nullifier must be released when the purchase fails");
    e.check_books().await?;

    // --------------------------- LP withdrawal: failed claim restores claimable
    let shares: String = e.view(&e.drop, "get_shares", json!({"account_id": e.lp})).await?;
    let half = (shares.parse::<u128>()? / 2).to_string();
    e.ok(&e.lp, &e.drop, "request_withdraw", json!({"shares": half})).await?;
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    e.ok(&e.bob, &e.drop, "roll_epoch", json!({})).await?;
    let claimable: String = e.view(&e.drop, "get_claimable", json!({"account_id": e.lp})).await?;
    assert!(claimable.parse::<u128>()? > 900 * USDC);
    e.set_blocked(&e.lp, true).await?;
    e.call(&e.lp, &e.drop, "claim_withdrawal", json!({}), 0).await?;
    let still: String = e.view(&e.drop, "get_claimable", json!({"account_id": e.lp})).await?;
    assert_eq!(still, claimable);
    e.check_books().await?;
    e.set_blocked(&e.lp, false).await?;
    let before = e.balance(&e.lp).await?;
    e.ok(&e.lp, &e.drop, "claim_withdrawal", json!({})).await?;
    assert_eq!(e.balance(&e.lp).await? - before, claimable.parse::<u128>()?);
    e.check_books().await?;

    // ------------------------------------------- timelocked params on-chain
    let owner: AccountId = "sandbox".parse()?;
    let mut np = test_params();
    np.cap.deductible = 1_500;
    e.ok(&owner, &e.reg, "propose_params", json!({"params": np})).await?;
    let r = e.call(&e.bob, &e.reg, "apply_params", json!({}), 0).await?;
    assert!(!r.is_success(), "apply before timelock must fail");
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    e.ok(&e.bob, &e.reg, "apply_params", json!({})).await?;
    let params: Value = e.view(&e.reg, "get_params", json!({})).await?;
    assert_eq!(params["cap"]["deductible"], 1_500);

    // ------------------------------------------- stale snapshot rejected
    let now = e.now().await?;
    let stale = e.sign_snapshot(17_000, now - 10_000, true);
    let r: Vec<String> = e.call(&e.lp, &e.att, "submit_snapshots", json!({"snapshots": [stale]}), 0).await?.into_full().expect("final").json()?;
    assert_eq!(r, vec!["stale snapshot".to_string()]);
    Ok(())
}

#[tokio::test]
async fn ui_formula_matches_contract_view() -> R<()> {
    // The web/TS port is checked against this same view in /shared tests; here we
    // check that the contract's view equals capfare-core for a grid of inputs.
    let e = Env::new().await?;
    let params = test_params();
    for (price, strike, mom, av, locked) in [(17_000u64, 18_000u64, 2u8, 1u8, 0u128), (25_000, 25_000, 4, 4, 3_000_000_000), (9_000, 15_000, 0, 0, 0)] {
        let inputs = PremiumInputs {
            product: Product::Cap,
            current_price: price,
            strike,
            signals: Signals { momentum_bucket: mom, availability_bucket: av, season_flag: mom > 2 },
            now: 1_900_000_000,
            departure_ts: 1_900_000_000 + 20 * 86_400,
            vault_total_assets: near_sdk::json_types::U128(4_000_000_000),
            vault_locked: near_sdk::json_types::U128(locked),
            vault_reserved: near_sdk::json_types::U128(0),
            new_lock: near_sdk::json_types::U128(108_000_000),
            flight_exposure: 0,
        };
        let onchain: Value = e.view(&e.reg, "preview_premium", json!({"inputs": inputs})).await?;
        let local = compute_premium(&params.cap, &inputs).unwrap();
        assert_eq!(onchain["premium"].as_u64().unwrap(), local.premium);
    }
    let h: Hash32 = e.view(&e.reg, "flight_key_hash", json!({"flight_key": flight()})).await?;
    assert_eq!(h, flight_key_hash(&flight()));
    Ok(())
}
