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
    pub flight_key_hash: Hash32,
    pub flight_key: FlightKey,
    /// Cap level (cap) or paid price (drop), cents.
    pub strike_minor: u64,
    pub deductible_minor: u64,
    pub max_payout_minor: u64,
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
    /// Payout in cents computed at claim/settlement time.
    pub payout_minor: Option<u64>,
    /// Earliest verified_at for the final status check (refundable/unknown fares).
    pub final_check_at: Option<u64>,
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
