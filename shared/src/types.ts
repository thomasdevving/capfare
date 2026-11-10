/** Mirrors contracts/core/src/types.rs and params.rs (JSON shapes). */
export type Product = "cap" | "drop";
export type BookingStatus = "active" | "cancelled" | "unknown";
export type Refundability = "non_refundable" | "refundable" | "unknown";
export type VerificationMethod = "dkim_eml" | "status_check" | "tls_page";
export type ServiceKind = "price_oracle" | "booking_verifier";

export const FARE_CLASSES = ["economy_light", "economy_standard", "economy_flex", "premium_economy", "business"] as const;
export type FareClass = (typeof FARE_CLASSES)[number];

export interface FlightKey {
  airline: string;
  flight_number: string;
  departure_date: string; // YYYY-MM-DD local at origin
  origin: string;
  destination: string;
  fare_class: string;
}

/** Mirrors capfare_core::MAX_SEATS. */
export const MAX_SEATS = 9;

/**
 * Any flight CapFare's oracle tracks between the origin and destination (an airport or an
 * airport group such as "@LON") on the day, or within `date_window_days` either side of it,
 * in one fare class.
 */
export interface RouteKey {
  origin: string;
  destination: string;
  departure_date: string;
  /** 0..=3 days either side; 0 (or missing) = that day only. */
  date_window_days?: number;
  fare_class: string;
}

/** JSON shape of capfare_core::Coverage (externally tagged enum). */
export type Coverage = { flight: FlightKey } | { route: RouteKey };

export interface Signals {
  momentum_bucket: number;
  availability_bucket: number;
  season_flag: boolean;
}

export interface PriceSnapshot {
  flight_key_hash: string; // hex
  price_minor: number;
  currency: string;
  available: boolean;
  signals: Signals;
  departure_ts: number;
  observed_at: number;
  source_id: string;
  enclave_measurement: string; // hex
}

export interface SignedSnapshot {
  snapshot: PriceSnapshot;
  signer: string; // hex ed25519 public key
  signature: string; // hex
}

export interface BookingAttestation {
  flight_key_hash: string;
  paid_price_minor: number;
  currency: string;
  fare_class: string;
  refundable: Refundability;
  booking_ref_nullifier: string;
  status: BookingStatus;
  method: VerificationMethod;
  booked_at: number;
  verified_at: number;
  enclave_measurement: string;
  passenger_commitment: string; // hex
  /** Travellers on the booking; paid_price_minor is per traveller. */
  seats: number;
}

export interface SignedBookingAttestation {
  attestation: BookingAttestation;
  signer: string;
  signature: string;
}

export interface ProductParams {
  price_bucket_bounds: number[];
  dtd_bucket_bounds: number[];
  base_table: number[][];
  momentum_mult_bps: number[];
  availability_mult_bps: number[];
  season_mult_bps: number;
  util_kink_bps: number;
  util_slope_bps: number;
  flight_slope_bps: number;
  moneyness_slope_bps: number;
  moneyness_floor_bps: number;
  min_premium: number;
  max_premium: number;
  /** Default deductible per traveller; one of deductible_options. */
  deductible: number;
  max_payout: number;
  /** Default cover duration; one of validity_options_secs. */
  validity_secs: number;
  deductible_options: number[];
  deductible_mult_bps: number[];
  validity_options_secs: number[];
  validity_mult_bps: number[];
  flex_window_mult_bps: number[];
  airport_group_mult_bps: number;
  activation_delay_secs: number;
  flight_exposure_cap: number;
  route_week_exposure_cap: number;
  max_per_user_per_flight: number;
  max_per_user_per_day: number;
  purchase_window_secs: number;
  min_secs_before_departure: number;
}

export interface GlobalParams {
  max_quote_snapshot_age_secs: number;
  max_index_snapshot_age_secs: number;
  max_attestation_age_secs: number;
  final_check_lead_secs: number;
  claim_grace_secs: number;
  /** A payout needs a live booking check at least this long after booking (free cancellations). */
  free_cancel_window_secs: number;
  sold_out_premium_refund: boolean;
  protocol_fee_bps: number;
  usdc_micro_per_cent: number;
  param_timelock_secs: number;
}

export interface Params {
  global: GlobalParams;
  cap: ProductParams;
  drop: ProductParams;
}

export interface PremiumInputs {
  product: Product;
  current_price: number;
  strike: number;
  signals: Signals;
  now: number;
  departure_ts: number;
  vault_total_assets: string; // U128 as decimal string
  vault_locked: string;
  vault_reserved: string;
  new_lock: string;
  flight_exposure: number;
  /** Chosen deductible per traveller; undefined = default. */
  deductible?: number | null;
  /** Chosen cover duration (seconds); undefined = default. */
  validity_secs?: number | null;
  /** Route cover only: days either side (0..=3). */
  route_window_days?: number | null;
  airport_group?: boolean;
}

export interface PremiumBreakdown {
  premium: number;
  unclamped: number;
  base: number;
  price_bucket: number;
  dtd_bucket: number;
  days_to_departure: number;
  momentum_mult_bps: number;
  availability_mult_bps: number;
  season_mult_bps: number;
  utilization_mult_bps: number;
  moneyness_mult_bps: number;
  utilization_bps: number;
  flight_exposure_ratio_bps: number;
  deductible_mult_bps: number;
  validity_mult_bps: number;
  flex_mult_bps: number;
  options_mult_bps: number;
  deductible: number;
  validity_secs: number;
  max_payout: number;
}

export type PolicyState = "funding" | "active" | "claimed" | "paid_out" | "expired" | "refunded" | "voided";

export interface Policy {
  id: number;
  owner: string;
  product: Product;
  /** Coverage hash: flight key hash, or route key hash for route coverage. */
  flight_key_hash: string;
  coverage: Coverage;
  seats: number;
  /** Per traveller. */
  strike_minor: number;
  deductible_minor: number;
  max_payout_minor: number;
  premium_minor: number;
  purchased_at: number;
  active_from: number;
  expires_at: number;
  departure_ts: number;
  state: PolicyState;
  booking_nullifier: string | null;
  lowest_price_seen_minor: number | null;
  index_at_booking_minor: number | null;
  paid_price_minor: number | null;
  refundable: Refundability | null;
  /** Total for all covered travellers. */
  payout_minor: number | null;
  booked_flight: FlightKey | null;
  booked_flight_key_hash: string | null;
  seats_covered: number | null;
  trip_id: number | null;
  auto_drop_max_premium_minor: number | null;
  linked_policy: number | null;
  final_check_at: number | null;
  booked_at?: number | null;
  /** Renewal chain (Price Caps). */
  renewal_of?: number | null;
  renewed_by?: number | null;
  usdc_micro_per_cent: number;
  premium_usdc: string;
  lock_usdc: string;
  route_week_key: string;
  passenger_commitment: string;
  busy: boolean;
  note: string | null;
}

export interface CapLeg {
  coverage: Coverage;
  strike_minor: number;
  max_premium_minor: number;
  deductible_minor?: number | null;
  validity_secs?: number | null;
}

export interface CapPurchase {
  legs: CapLeg[];
  seats: number;
  passenger_commitment: string;
  auto_drop_max_premium_minor: number | null;
}

export interface VaultState {
  name: string;
  token: string;
  registry: string;
  epoch: number;
  epoch_start: number;
  epoch_secs: number;
  next_epoch_at: number;
  total_assets: string;
  total_shares: string;
  locked_coverage: string;
  pending_withdrawals: string;
  unearned_premiums: string;
  fees_accrued: string;
  pending_deposits: string;
  claimable_total: string;
  in_flight: string;
  free_liquidity: string;
  share_price_e6: string;
  active_positions: number;
  premiums_earned_total: string;
  payouts_total: string;
  invariant_ok: boolean;
  deposit_queue_len: number;
  withdraw_queue_len: number;
}

export interface SnapshotRecord {
  price_minor: number;
  available: boolean;
  signals: Signals;
  departure_ts: number;
  observed_at: number;
  demo: boolean;
}
