use capfare_core::*;
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyState {
    /// Premium sent to the vault, waiting for the lock confirmation.
    Funding,
    Active,
    /// Claim verified; payout pending (final status check or transfer retry).
    Claimed,
    PaidOut,
    Expired,
    Refunded,
    Voided,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Policy {
    pub id: u64,
    pub owner: AccountId,
    pub product: Product,
    /// Hash of the coverage: the flight key hash, or the route key hash for route coverage.
    /// Oracle snapshots, exposure and per-user limits are keyed by it.
    pub flight_key_hash: Hash32,
    pub coverage: Coverage,
    /// Travellers covered (same booking, same flight). Amounts below marked "per traveller"
    /// are multiplied by the covered seats for payouts, locks and exposure.
    pub seats: u8,
    /// Cap level (cap) or paid price (drop), cents per traveller.
    pub strike_minor: u64,
    /// Per traveller.
    pub deductible_minor: u64,
    /// Per traveller.
    pub max_payout_minor: u64,
    /// Total premium for all seats.
    pub premium_minor: u64,
    pub purchased_at: u64,
    pub active_from: u64,
    pub expires_at: u64,
    pub departure_ts: u64,
    pub state: PolicyState,
    pub booking_nullifier: Option<Hash32>,
    /// Drop only (set at settlement).
    pub lowest_price_seen_minor: Option<u64>,
    /// Cap only (set at claim).
    pub index_at_booking_minor: Option<u64>,
    pub paid_price_minor: Option<u64>,
    pub refundable: Option<Refundability>,
    /// Total payout in cents (all covered seats) computed at claim/settlement time.
    pub payout_minor: Option<u64>,
    /// The flight actually booked (set when a booking is attached: cap claim, drop purchase).
    pub booked_flight: Option<FlightKey>,
    pub booked_flight_key_hash: Option<Hash32>,
    /// min(policy seats, travellers on the booking), set when a booking is attached.
    pub seats_covered: Option<u8>,
    /// Policies bought together as one trip (outbound + return) share the id of the first leg.
    pub trip_id: Option<u64>,
    /// Price Cap opt-in: when claimed, also add a Drop Guarantee for the booking, paying at
    /// most this premium (total, cents). None = not wanted.
    pub auto_drop_max_premium_minor: Option<u64>,
    /// Cap -> the Drop Guarantee added with its booking, and back.
    pub linked_policy: Option<u64>,
    /// Earliest verified_at for the live booking check that releases a held payout: the end of
    /// the free-cancellation window after booking, and for refundable/unknown fares departure
    /// minus the final-check lead, whichever is later.
    pub final_check_at: Option<u64>,
    /// When the booking was made (set when a booking is attached).
    pub booked_at: Option<u64>,
    /// Renewal: the Price Cap this one continues (it starts when that one ends), and back.
    pub renewal_of: Option<u64>,
    pub renewed_by: Option<u64>,
    /// Settlement FX locked at purchase.
    pub usdc_micro_per_cent: u64,
    pub premium_usdc: U128,
    pub lock_usdc: U128,
    pub route_week_key: Hash32,
    /// Commitment to the lead passenger (see BookingAttestation.passenger_commitment).
    pub passenger_commitment: Hash32,
    pub busy: bool,
    pub note: Option<String>,
}

impl Policy {
    /// Exposure this policy adds (cents): max payout per traveller times seats.
    pub fn exposure_minor(&self) -> u64 {
        self.max_payout_minor * u64::from(self.seats)
    }
    /// The flight whose booking status matters (booked flight once known).
    pub fn status_key(&self) -> Hash32 {
        self.booked_flight_key_hash.unwrap_or(self.flight_key_hash)
    }
}

/// One leg of a Price Cap purchase.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CapLeg {
    pub coverage: Coverage,
    /// Cap per traveller, cents.
    pub strike_minor: u64,
    /// Highest acceptable premium for this leg (all seats), cents.
    pub max_premium_minor: u64,
    /// Chosen deductible per traveller (one of the product's options); None = default.
    #[serde(default)]
    pub deductible_minor: Option<u64>,
    /// Chosen cover duration in seconds (one of the product's options); None = default.
    #[serde(default)]
    pub validity_secs: Option<u64>,
}

/// Price Cap purchase: one leg, or two legs bought together (outbound and return).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CapPurchase {
    pub legs: Vec<CapLeg>,
    /// Travellers to cover (1..=MAX_SEATS), all on one booking.
    pub seats: u8,
    pub passenger_commitment: Hash32,
    /// Opt-in Drop Guarantee after the claim (see Policy).
    pub auto_drop_max_premium_minor: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingParams {
    pub params: Params,
    pub apply_after: u64,
    pub proposed_at: u64,
}

#[near(serializers = [json])]
pub struct Stats {
    pub policies_total: u64,
    pub active_cap: u64,
    pub active_drop: u64,
    pub credit_total: U128,
    pub in_flight: U128,
    pub paused: bool,
}

/// Subset of the vault's get_state used for pricing.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultFigures {
    pub total_assets: U128,
    pub locked_coverage: U128,
    pub pending_withdrawals: U128,
    pub free_liquidity: U128,
}

/// Subset of the attestation registry's SnapshotRecord.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SnapshotView {
    pub price_minor: u64,
    pub available: bool,
    pub signals: Signals,
    pub departure_ts: u64,
    pub observed_at: u64,
    pub demo: bool,
}

#[near(serializers = [json])]
pub struct BookingCheckView {
    pub attestation: BookingAttestation,
    pub index_price: Option<u64>,
    pub latest: Option<SnapshotView>,
}

#[near(serializers = [json])]
pub struct StatusCheckView {
    pub status: BookingStatus,
    pub refundable: Refundability,
    pub verified_at: u64,
    pub lowest_price: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Debug)]
#[serde(rename_all = "snake_case")]
pub enum CreditMsg {
    TopUp,
    TopUpFor { account_id: AccountId },
}
