//! Canonical byte encodings and digests. The TS port in `/shared/src/encoding.ts`
//! must produce identical bytes. Borsh rules used here: String = u32 LE length +
//! UTF-8 bytes; u8/u64 little-endian; bool = 1 byte; unit enums = u8 variant index;
//! fixed arrays = raw bytes.

use crate::types::*;
use near_sdk::borsh;
use near_sdk::env;

pub const FLIGHT_KEY_DOMAIN: &[u8] = b"capfare/flight-key/v1";
pub const SNAPSHOT_DOMAIN: &[u8] = b"capfare/price-snapshot/v1";
pub const ATTESTATION_DOMAIN: &[u8] = b"capfare/booking-attestation/v1";
pub const ROUTE_WEEK_DOMAIN: &[u8] = b"capfare/route-week/v1";
pub const ROUTE_KEY_DOMAIN: &[u8] = b"capfare/route-key/v1";
pub const LEG_NULLIFIER_DOMAIN: &[u8] = b"capfare/leg-nullifier/v1";

fn digest(domain: &[u8], body: &[u8]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(domain.len() + body.len());
    buf.extend_from_slice(domain);
    buf.extend_from_slice(body);
    env::sha256_array(&buf)
}

pub fn flight_key_hash(k: &FlightKey) -> Hash32 {
    Hash32(digest(FLIGHT_KEY_DOMAIN, &borsh::to_vec(k).unwrap()))
}

/// Key of a route index (the oracle publishes route snapshots under this hash).
pub fn route_key_hash(k: &RouteKey) -> Hash32 {
    Hash32(digest(ROUTE_KEY_DOMAIN, &borsh::to_vec(k).unwrap()))
}

/// Hash that policies, snapshots and exposure use for a coverage.
pub fn coverage_hash(c: &Coverage) -> Hash32 {
    match c {
        Coverage::Flight(k) => flight_key_hash(k),
        Coverage::Route(r) => route_key_hash(r),
    }
}

/// One booking can hold several flights (a return trip). Nullifiers are spent per flight,
/// so each leg can be claimed once: H(booking nullifier || flight key hash).
pub fn leg_nullifier(booking_nullifier: &Hash32, flight_key_hash: &Hash32) -> Hash32 {
    let mut body = [0u8; 64];
    body[..32].copy_from_slice(&booking_nullifier.0);
    body[32..].copy_from_slice(&flight_key_hash.0);
    Hash32(digest(LEG_NULLIFIER_DOMAIN, &body))
}

/// The 32-byte message the oracle enclave signs with ed25519.
pub fn snapshot_digest(s: &PriceSnapshot) -> [u8; 32] {
    digest(SNAPSHOT_DOMAIN, &borsh::to_vec(s).unwrap())
}

/// The 32-byte message the booking_verifier enclave signs with ed25519.
pub fn attestation_digest(a: &BookingAttestation) -> [u8; 32] {
    digest(ATTESTATION_DOMAIN, &borsh::to_vec(a).unwrap())
}

pub const SECS_PER_DAY: u64 = 86_400;
pub const SECS_PER_WEEK: u64 = 7 * SECS_PER_DAY;

/// Correlated-risk bucket: one route (directional) in one Unix week of departure.
pub fn route_week_key(origin: &str, destination: &str, departure_ts: Timestamp) -> Hash32 {
    let week = departure_ts / SECS_PER_WEEK;
    let body = borsh::to_vec(&(origin.to_string(), destination.to_string(), week)).unwrap();
    Hash32(digest(ROUTE_WEEK_DOMAIN, &body))
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn demo_key() -> FlightKey {
        FlightKey {
            airline: "KL".into(),
            flight_number: "KL1695".into(),
            departure_date: "2027-06-14".into(),
            origin: "AMS".into(),
            destination: "BCN".into(),
            fare_class: "economy_light".into(),
        }
    }

    #[test]
    fn flight_key_borsh_layout_is_stable() {
        let bytes = borsh::to_vec(&demo_key()).unwrap();
        // "KL" => 02 00 00 00 4b 4c
        assert_eq!(&bytes[..6], &[2, 0, 0, 0, b'K', b'L']);
        assert!(demo_key().validate().is_ok());
    }

    #[test]
    fn hash_changes_with_fare_class() {
        let mut k = demo_key();
        let a = flight_key_hash(&k);
        k.fare_class = "economy_standard".into();
        assert_ne!(a, flight_key_hash(&k));
    }

    #[test]
    fn route_coverage_matches_flights_on_the_route_and_day() {
        let r = RouteKey { origin: "AMS".into(), destination: "BCN".into(), departure_date: "2027-06-14".into(), fare_class: "economy_light".into() };
        assert!(r.validate().is_ok());
        let c = Coverage::Route(r.clone());
        assert!(c.covers(&demo_key()));
        let mut other = demo_key();
        other.flight_number = "VY1234".into();
        other.airline = "VY".into();
        assert!(c.covers(&other));
        other.fare_class = "economy_flex".into();
        assert!(!c.covers(&other));
        let mut wrong_day = demo_key();
        wrong_day.departure_date = "2027-06-15".into();
        assert!(!c.covers(&wrong_day));
        // Exact-flight coverage only covers that flight.
        assert!(!Coverage::Flight(demo_key()).covers(&wrong_day));
        // Route and flight keys never collide.
        assert_ne!(coverage_hash(&c), coverage_hash(&Coverage::Flight(demo_key())));
        let mut bad = r;
        bad.destination = "AMS".into();
        assert!(bad.validate().is_err());
    }

    #[test]
    fn leg_nullifiers_differ_per_flight() {
        let n = Hash32([9u8; 32]);
        let a = flight_key_hash(&demo_key());
        let mut back = demo_key();
        back.origin = "BCN".into();
        back.destination = "AMS".into();
        let b = flight_key_hash(&back);
        assert_ne!(leg_nullifier(&n, &a), leg_nullifier(&n, &b));
        assert_eq!(leg_nullifier(&n, &a), leg_nullifier(&n, &a));
    }

    #[test]
    fn validation_rejects_bad_keys() {
        let mut k = demo_key();
        k.flight_number = "AF1695".into();
        assert!(k.validate().is_err());
        let mut k = demo_key();
        k.departure_date = "14-06-2027".into();
        assert!(k.validate().is_err());
        let mut k = demo_key();
        k.destination = "AMS".into();
        assert!(k.validate().is_err());
    }
}
