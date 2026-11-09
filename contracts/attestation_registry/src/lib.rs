//! CapFare attestation registry.
//!
//! * Allowed enclave signing keys + measurements per service, added only through a
//!   timelocked admin flow after off-chain verification of the TEE quote
//!   (see docs/THREAT_MODEL.md, "TEE trust"). Revocation is immediate.
//! * Signed oracle price snapshots (history per flight).
//! * Booking attestation verification and per-product nullifiers.

use capfare_core::*;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, IterableSet, LookupMap, LookupSet, Vector};
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Keys,
    PendingKeys,
    Latest,
    History,
    HistoryFor(Hash32),
    Nullifiers,
    Flights,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct KeyInfo {
    pub service: ServiceKind,
    pub measurement: Hash32,
    /// sha256 of the published attestation report (quote + collateral).
    pub report_hash: Hash32,
    pub registered_at: u64,
    pub revoked: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingKey {
    pub service: ServiceKind,
    pub measurement: Hash32,
    pub report_hash: Hash32,
    pub apply_after: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotRecord {
    pub price_minor: u64,
    pub available: bool,
    pub signals: Signals,
    pub departure_ts: u64,
    pub observed_at: u64,
    pub demo: bool,
}

#[near(serializers = [json])]
pub struct BookingCheck {
    pub attestation: BookingAttestation,
    /// Cap only: oracle price for the flight at booking time.
    pub index_price: Option<u64>,
    pub latest: Option<SnapshotRecord>,
}

#[near(serializers = [json])]
pub struct StatusCheck {
    pub status: BookingStatus,
    pub refundable: Refundability,
    pub verified_at: u64,
    pub lowest_price: Option<u64>,
}

#[near(serializers = [json])]
pub struct FlightFreshness {
    pub flight_key_hash: Hash32,
    pub latest: Option<SnapshotRecord>,
    pub count: u32,
}

pub const MAX_FUTURE_SKEW_SECS: u64 = 300;
pub const MAX_BATCH: usize = 50;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AttestationRegistry {
    owner: AccountId,
    /// The policy registry: the only account that can consume nullifiers.
    registry: AccountId,
    key_timelock_secs: u64,
    /// Fixed at init: demo deployments accept snapshots tagged source_id="demo".
    allow_demo_sources: bool,
    max_snapshot_submit_age_secs: u64,
    keys: IterableMap<Hash32, KeyInfo>,
    pending_keys: IterableMap<Hash32, PendingKey>,
    latest: LookupMap<Hash32, SnapshotRecord>,
    history: LookupMap<Hash32, Vector<SnapshotRecord>>,
    nullifiers: LookupSet<(Product, Hash32)>,
    flights: IterableSet<Hash32>,
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn event(kind: &str, data: serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        json!({"standard": "capfare_attestation", "version": "1.0.0", "event": kind, "data": [data]})
    );
}

#[near]
impl AttestationRegistry {
    #[init]
    pub fn new(
        owner: AccountId,
        registry: AccountId,
        key_timelock_secs: u64,
        allow_demo_sources: bool,
        max_snapshot_submit_age_secs: u64,
    ) -> Self {
        Self {
            owner,
            registry,
            key_timelock_secs,
            allow_demo_sources,
            max_snapshot_submit_age_secs,
            keys: IterableMap::new(Key::Keys),
            pending_keys: IterableMap::new(Key::PendingKeys),
            latest: LookupMap::new(Key::Latest),
            history: LookupMap::new(Key::History),
            nullifiers: LookupSet::new(Key::Nullifiers),
            flights: IterableSet::new(Key::Flights),
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    fn assert_registry(&self) {
        require!(env::predecessor_account_id() == self.registry, "only the policy registry");
    }

    // ------------------------------------------------------------- key management

    /// Publishes a new enclave key. It becomes usable after the timelock.
    pub fn propose_key(&mut self, public_key: Hash32, service: ServiceKind, measurement: Hash32, report_hash: Hash32) {
        self.assert_owner();
        require!(!self.keys.contains_key(&public_key), "key already registered");
        let apply_after = now_secs() + self.key_timelock_secs;
        self.pending_keys.insert(public_key, PendingKey { service, measurement, report_hash, apply_after });
        event("key_proposed", json!({"public_key": public_key, "service": service, "measurement": measurement, "report_hash": report_hash, "apply_after": apply_after}));
    }

    /// Anyone can apply a proposed key once its timelock has passed.
    pub fn apply_key(&mut self, public_key: Hash32) {
        let p = self.pending_keys.get(&public_key).cloned().unwrap_or_else(|| env::panic_str("no pending key"));
        require!(now_secs() >= p.apply_after, "timelock has not passed");
        self.pending_keys.remove(&public_key);
        self.keys.insert(
            public_key,
            KeyInfo { service: p.service, measurement: p.measurement, report_hash: p.report_hash, registered_at: now_secs(), revoked: false },
        );
        event("key_registered", json!({"public_key": public_key, "service": p.service, "measurement": p.measurement}));
    }

    pub fn cancel_key(&mut self, public_key: Hash32) {
        self.assert_owner();
        require!(self.pending_keys.remove(&public_key).is_some(), "no pending key");
        event("key_cancelled", json!({"public_key": public_key}));
    }

    /// Emergency revocation (compromised enclave). Immediate by design.
    pub fn revoke_key(&mut self, public_key: Hash32) {
        self.assert_owner();
        let k = self.keys.get_mut(&public_key).unwrap_or_else(|| env::panic_str("unknown key"));
        k.revoked = true;
        event("key_revoked", json!({"public_key": public_key}));
    }

    fn check_signer(&self, signer: &Hash32, service: ServiceKind, measurement: &Hash32) -> Result<(), &'static str> {
        let k = self.keys.get(signer).ok_or("signer not registered")?;
        if k.revoked {
            return Err("signer revoked");
        }
        if k.service != service {
            return Err("signer registered for another service");
        }
        if &k.measurement != measurement {
            return Err("enclave measurement mismatch");
        }
        Ok(())
    }

    // ----------------------------------------------------------------- snapshots

    fn validate_snapshot(&self, s: &SignedSnapshot, now: u64) -> Result<(), &'static str> {
        let snap = &s.snapshot;
        self.check_signer(&s.signer, ServiceKind::PriceOracle, &snap.enclave_measurement)?;
        if !env::ed25519_verify(&s.signature.0, &snapshot_digest(snap), &s.signer.0) {
            return Err("bad signature");
        }
        if snap.currency != "EUR" {
            return Err("unsupported currency");
        }
        snap.signals.validate()?;
        if snap.source_id == "demo" && !self.allow_demo_sources {
            return Err("demo snapshots are not accepted on this deployment");
        }
        if snap.observed_at > now + MAX_FUTURE_SKEW_SECS {
            return Err("snapshot from the future");
        }
        if snap.observed_at + self.max_snapshot_submit_age_secs < now {
            return Err("stale snapshot");
        }
        if let Some(l) = self.latest.get(&snap.flight_key_hash) {
            if snap.observed_at <= l.observed_at {
                return Err("not newer than the latest snapshot");
            }
        }
        Ok(())
    }

    /// Accepts a batch of signed snapshots (typically via the relayer). Each item
    /// is validated independently; the result lists "ok" or the rejection reason.
    pub fn submit_snapshots(&mut self, snapshots: Vec<SignedSnapshot>) -> Vec<String> {
        require!(snapshots.len() <= MAX_BATCH, "batch too large");
        let now = now_secs();
        let mut out = Vec::with_capacity(snapshots.len());
        for s in snapshots {
            match self.validate_snapshot(&s, now) {
                Err(e) => {
                    event("snapshot_rejected", json!({"flight_key_hash": s.snapshot.flight_key_hash, "reason": e}));
                    out.push(e.to_string());
                }
                Ok(()) => {
                    let snap = s.snapshot;
                    let rec = SnapshotRecord {
                        price_minor: snap.price_minor,
                        available: snap.available,
                        signals: snap.signals,
                        departure_ts: snap.departure_ts,
                        observed_at: snap.observed_at,
                        demo: snap.source_id == "demo",
                    };
                    let fkh = snap.flight_key_hash;
                    if !self.history.contains_key(&fkh) {
                        self.history.insert(fkh, Vector::new(Key::HistoryFor(fkh)));
                        self.flights.insert(fkh);
                    }
                    self.history.get_mut(&fkh).unwrap().push(rec.clone());
                    self.latest.insert(fkh, rec);
                    event("snapshot", json!({"flight_key_hash": fkh, "price_minor": snap.price_minor, "available": snap.available, "observed_at": snap.observed_at, "source_id": snap.source_id}));
                    out.push("ok".into());
                }
            }
        }
        out
    }

    /// Index of the first record with observed_at >= t (records are sorted).
    fn lower_bound(v: &Vector<SnapshotRecord>, t: u64) -> u32 {
        let (mut lo, mut hi) = (0u32, v.len());
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if v.get(mid).unwrap().observed_at < t {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    /// Latest available-fare snapshot with observed_at in [t - max_age, t].
    pub fn index_price_at(&self, flight_key_hash: Hash32, t: u64, max_age_secs: u64) -> Option<u64> {
        let v = self.history.get(&flight_key_hash)?;
        let mut i = Self::lower_bound(v, t.saturating_add(1));
        while i > 0 {
            i -= 1;
            let r = v.get(i).unwrap();
            if r.observed_at + max_age_secs < t {
                return None;
            }
            if r.available {
                return Some(r.price_minor);
            }
        }
        None
    }

    /// Lowest available-fare price observed in [from, to].
    pub fn lowest_price_between(&self, flight_key_hash: Hash32, from: u64, to: u64) -> Option<u64> {
        let v = self.history.get(&flight_key_hash)?;
        let mut i = Self::lower_bound(v, from);
        let mut low: Option<u64> = None;
        while i < v.len() {
            let r = v.get(i).unwrap();
            if r.observed_at > to {
                break;
            }
            if r.available {
                low = Some(low.map_or(r.price_minor, |l| l.min(r.price_minor)));
            }
            i += 1;
        }
        low
    }

    // ------------------------------------------------------- booking attestations

    fn validate_attestation(&self, a: &SignedBookingAttestation, max_age_secs: u64) -> Result<(), &'static str> {
        let att = &a.attestation;
        self.check_signer(&a.signer, ServiceKind::BookingVerifier, &att.enclave_measurement)?;
        if !env::ed25519_verify(&a.signature.0, &attestation_digest(att), &a.signer.0) {
            return Err("bad signature");
        }
        let now = now_secs();
        if att.verified_at > now + MAX_FUTURE_SKEW_SECS {
            return Err("attestation from the future");
        }
        if att.verified_at + max_age_secs < now {
            return Err("stale attestation");
        }
        if att.currency != "EUR" {
            return Err("unsupported currency");
        }
        if att.booked_at > att.verified_at + MAX_FUTURE_SKEW_SECS {
            return Err("booking time after verification time");
        }
        Ok(())
    }

    /// Verifies a booking attestation and consumes its nullifier for `product`.
    /// Called by the policy registry for cap claims and drop purchases.
    pub fn consume_booking(
        &mut self,
        attestation: SignedBookingAttestation,
        product: Product,
        max_age_secs: u64,
        index_max_age_secs: u64,
    ) -> BookingCheck {
        self.assert_registry();
        if let Err(e) = self.validate_attestation(&attestation, max_age_secs) {
            env::panic_str(e);
        }
        let att = attestation.attestation;
        let index_price = if product == Product::Cap {
            let ix = self.index_price_at(att.flight_key_hash, att.booked_at, index_max_age_secs);
            require!(ix.is_some(), "no valid oracle price for this flight at booking time");
            ix
        } else {
            None
        };
        let key = (product, att.booking_ref_nullifier);
        require!(!self.nullifiers.contains(&key), "booking already used for this product");
        self.nullifiers.insert(key);
        event("nullifier_used", json!({"product": product, "nullifier": att.booking_ref_nullifier}));
        let latest = self.latest.get(&att.flight_key_hash).cloned();
        BookingCheck { attestation: att, index_price, latest }
    }

    /// Undo of `consume_booking` when the registry's follow-up step fails.
    pub fn release_nullifier(&mut self, product: Product, nullifier: Hash32) {
        self.assert_registry();
        self.nullifiers.remove(&(product, nullifier));
        event("nullifier_released", json!({"product": product, "nullifier": nullifier}));
    }

    /// Verifies a status attestation for an already-registered booking. Optionally
    /// returns the lowest price seen in [low_from, low_to] (drop settlement).
    /// `require_live`: refundable/unknown fares must be re-checked on the booking site
    /// (status check or TLS page), because an email cannot show a later cancellation.
    #[allow(clippy::too_many_arguments)]
    pub fn check_status(
        &self,
        attestation: SignedBookingAttestation,
        nullifier: Hash32,
        flight_key_hash: Hash32,
        passenger_commitment: Hash32,
        require_live: bool,
        min_verified_at: u64,
        max_age_secs: u64,
        low_from: Option<u64>,
        low_to: Option<u64>,
    ) -> StatusCheck {
        if let Err(e) = self.validate_attestation(&attestation, max_age_secs) {
            env::panic_str(e);
        }
        let att = attestation.attestation;
        require!(att.booking_ref_nullifier == nullifier, "attestation is for another booking");
        require!(att.flight_key_hash == flight_key_hash, "attestation is for another flight");
        require!(att.verified_at >= min_verified_at, "status check is too early");
        require!(att.passenger_commitment == passenger_commitment, "booking is for another passenger");
        require!(
            !require_live || att.method.is_live(),
            "refundable tickets need a live check of the booking (CapFare extension or booking code), not the email"
        );
        let lowest_price = match (low_from, low_to) {
            (Some(f), Some(t)) => self.lowest_price_between(flight_key_hash, f, t),
            _ => None,
        };
        StatusCheck { status: att.status, refundable: att.refundable, verified_at: att.verified_at, lowest_price }
    }

    // ---------------------------------------------------------------------- views

    pub fn get_latest_snapshot(&self, flight_key_hash: Hash32) -> Option<SnapshotRecord> {
        self.latest.get(&flight_key_hash).cloned()
    }

    pub fn get_snapshots(&self, flight_key_hash: Hash32, from: Option<u64>, limit: Option<u32>) -> Vec<SnapshotRecord> {
        let Some(v) = self.history.get(&flight_key_hash) else { return vec![] };
        let start = Self::lower_bound(v, from.unwrap_or(0));
        let limit = limit.unwrap_or(200).min(500);
        (start..v.len()).take(limit as usize).map(|i| v.get(i).unwrap().clone()).collect()
    }

    pub fn get_flights(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<FlightFreshness> {
        self.flights
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .map(|f| FlightFreshness {
                flight_key_hash: *f,
                latest: self.latest.get(f).cloned(),
                count: self.history.get(f).map(|v| v.len()).unwrap_or(0),
            })
            .collect()
    }

    pub fn get_keys(&self) -> Vec<(Hash32, KeyInfo)> {
        self.keys.iter().map(|(k, v)| (*k, v.clone())).collect()
    }

    pub fn get_pending_keys(&self) -> Vec<(Hash32, PendingKey)> {
        self.pending_keys.iter().map(|(k, v)| (*k, v.clone())).collect()
    }

    pub fn is_nullifier_used(&self, product: Product, nullifier: Hash32) -> bool {
        self.nullifiers.contains(&(product, nullifier))
    }

    pub fn get_config(&self) -> serde_json::Value {
        json!({
            "owner": self.owner,
            "registry": self.registry,
            "key_timelock_secs": self.key_timelock_secs,
            "allow_demo_sources": self.allow_demo_sources,
            "max_snapshot_submit_age_secs": self.max_snapshot_submit_age_secs,
        })
    }
}

#[cfg(test)]
mod tests;
