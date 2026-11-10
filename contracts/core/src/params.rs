//! Public premium and risk parameters. Values are produced by `/backtest` and
//! written on-chain by `scripts/deploy`. Every field is readable via view methods.

use near_sdk::near;

/// Parameters of one product (Price Cap or Drop Guarantee). The two products are
/// priced and capitalised independently.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProductParams {
    /// Ascending price thresholds in cents. n thresholds => n+1 price buckets.
    pub price_bucket_bounds: Vec<u64>,
    /// Ascending days-to-departure thresholds. m thresholds => m+1 buckets.
    pub dtd_bucket_bounds: Vec<u32>,
    /// base_table[price_bucket][dtd_bucket], in cents.
    pub base_table: Vec<Vec<u64>>,
    /// Multipliers in basis points (10_000 = 1.0x), indexed by signal bucket 0..=4.
    pub momentum_mult_bps: [u32; 5],
    pub availability_mult_bps: [u32; 5],
    pub season_mult_bps: u32,
    /// Utilisation surcharge: +util_slope_bps * max(0, util - util_kink) / 10_000.
    pub util_kink_bps: u32,
    pub util_slope_bps: u32,
    /// Flight-concentration surcharge: +flight_slope_bps * flight_exposure_ratio / 10_000.
    pub flight_slope_bps: u32,
    /// Moneyness (cap only): adj = max(floor, 10_000 - otm_bps * slope / 10_000),
    /// where otm_bps = (strike - price) * 10_000 / price.
    pub moneyness_slope_bps: u32,
    pub moneyness_floor_bps: u32,
    pub min_premium: u64,
    pub max_premium: u64,
    /// Default deductible per traveller (cents); one of `deductible_options`.
    pub deductible: u64,
    pub max_payout: u64,
    /// Default cover duration (seconds); one of `validity_options_secs`.
    pub validity_secs: u64,
    /// Deductibles a buyer can choose (per traveller, cents, ascending) and the premium
    /// multiplier for each (bps). A higher deductible pays less, so it costs less.
    pub deductible_options: Vec<u64>,
    pub deductible_mult_bps: Vec<u32>,
    /// Cover durations a buyer can choose (seconds, ascending) and the premium multiplier for
    /// each (bps, a duration dimension of the base table calibrated by the backtest).
    pub validity_options_secs: Vec<u64>,
    pub validity_mult_bps: Vec<u32>,
    /// Flexible route cover: premium multiplier by date window (index = days either side,
    /// 0..=3), and a further multiplier when either end is an airport group.
    pub flex_window_mult_bps: [u32; 4],
    pub airport_group_mult_bps: u32,
    /// Price Cap only: the policy cannot pay for bookings before purchase + delay.
    pub activation_delay_secs: u64,
    /// Max sum of outstanding max payouts (cents) per flight_key_hash.
    pub flight_exposure_cap: u64,
    /// Max sum of outstanding max payouts (cents) per route and departure week.
    pub route_week_exposure_cap: u64,
    pub max_per_user_per_flight: u32,
    pub max_per_user_per_day: u32,
    /// Drop only: max seconds between the booking time and the purchase.
    pub purchase_window_secs: u64,
    /// No sales when departure is closer than this.
    pub min_secs_before_departure: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalParams {
    /// Quotes/purchases need a snapshot no older than this (e.g. 3600).
    pub max_quote_snapshot_age_secs: u64,
    /// A snapshot used as the cap index must be at most this old at booking time.
    pub max_index_snapshot_age_secs: u64,
    /// Booking attestations must be submitted within this age.
    pub max_attestation_age_secs: u64,
    /// Refundable/unknown fares: final status check at departure - lead.
    pub final_check_lead_secs: u64,
    /// Claims (cap) and settlements (drop) accepted until expiry + grace.
    pub claim_grace_secs: u64,
    /// Many bookings can be cancelled free shortly after booking (US rule: 24 hours for
    /// flights booked 7+ days ahead; some airlines everywhere). A payout needs a live check
    /// of the booking verified at least this long after it was booked.
    pub free_cancel_window_secs: u64,
    pub sold_out_premium_refund: bool,
    /// Protocol fee on earned premiums, in bps.
    pub protocol_fee_bps: u32,
    /// Settlement FX: micro-USDC per EUR cent (10_800 = 1.08 USDC/EUR). Locked
    /// into each policy at purchase so coverage stays exactly collateralised.
    pub usdc_micro_per_cent: u64,
    /// Delay between publishing and applying a parameter change.
    pub param_timelock_secs: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Params {
    pub global: GlobalParams,
    pub cap: ProductParams,
    pub drop: ProductParams,
}

/// Upper bound for the buyer-option multipliers (deductible, duration, flexible cover).
pub const MAX_OPTION_MULT_BPS: u32 = 30_000;

impl ProductParams {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.price_bucket_bounds.windows(2).all(|w| w[0] < w[1]) {
            return Err("price_bucket_bounds must be strictly ascending");
        }
        if !self.dtd_bucket_bounds.windows(2).all(|w| w[0] < w[1]) {
            return Err("dtd_bucket_bounds must be strictly ascending");
        }
        if self.base_table.len() != self.price_bucket_bounds.len() + 1 {
            return Err("base_table rows must equal price buckets");
        }
        if self
            .base_table
            .iter()
            .any(|r| r.len() != self.dtd_bucket_bounds.len() + 1)
        {
            return Err("base_table columns must equal dtd buckets");
        }
        let all_mults = self
            .momentum_mult_bps
            .iter()
            .chain(self.availability_mult_bps.iter())
            .chain(core::iter::once(&self.season_mult_bps));
        for m in all_mults {
            if *m == 0 || *m > 100_000 {
                return Err("multipliers must be in 1..=100000 bps");
            }
        }
        if self.moneyness_floor_bps == 0 || self.moneyness_floor_bps > 10_000 {
            return Err("moneyness_floor_bps must be in 1..=10000");
        }
        if self.util_kink_bps > 10_000 || self.util_slope_bps > 1_000_000 || self.flight_slope_bps > 1_000_000 {
            return Err("utilisation params out of range");
        }
        if self.min_premium == 0 || self.min_premium > self.max_premium {
            return Err("need 0 < min_premium <= max_premium");
        }
        if self.max_premium >= self.max_payout {
            return Err("max_premium must be below max_payout");
        }
        if self.max_payout == 0 || self.validity_secs == 0 {
            return Err("max_payout and validity must be positive");
        }
        if self.flight_exposure_cap < self.max_payout || self.route_week_exposure_cap < self.max_payout {
            return Err("exposure caps must allow at least one policy");
        }
        if self.max_per_user_per_flight == 0 || self.max_per_user_per_day == 0 {
            return Err("per-user limits must be positive");
        }
        let opt_mult_ok = |m: &u32| *m > 0 && *m <= MAX_OPTION_MULT_BPS;
        if self.deductible_options.is_empty() || self.deductible_options.len() != self.deductible_mult_bps.len() {
            return Err("each deductible option needs a multiplier");
        }
        if !self.deductible_options.windows(2).all(|w| w[0] < w[1]) || !self.deductible_options.contains(&self.deductible) {
            return Err("deductible options must be ascending and include the default deductible");
        }
        if self.deductible_options.iter().any(|d| *d >= self.max_payout) {
            return Err("deductible options must be below the maximum payout");
        }
        // A higher deductible never costs more.
        if !self.deductible_mult_bps.iter().all(opt_mult_ok) || !self.deductible_mult_bps.windows(2).all(|w| w[0] >= w[1]) {
            return Err("deductible multipliers must be in 1..=30000 bps and not increase with the deductible");
        }
        if self.validity_options_secs.is_empty() || self.validity_options_secs.len() != self.validity_mult_bps.len() {
            return Err("each duration option needs a multiplier");
        }
        if !self.validity_options_secs.windows(2).all(|w| w[0] < w[1]) || !self.validity_options_secs.contains(&self.validity_secs) {
            return Err("duration options must be ascending and include the default duration");
        }
        // Longer cover never costs less.
        if !self.validity_mult_bps.iter().all(opt_mult_ok) || !self.validity_mult_bps.windows(2).all(|w| w[0] <= w[1]) {
            return Err("duration multipliers must be in 1..=30000 bps and not decrease with the duration");
        }
        if !self.flex_window_mult_bps.iter().all(opt_mult_ok) || !opt_mult_ok(&self.airport_group_mult_bps) {
            return Err("flexible cover multipliers must be in 1..=30000 bps");
        }
        // Keeps the premium's integer product inside u128 (see premium.rs).
        let max = |v: &[u32]| v.iter().copied().max().unwrap_or(0) as u128;
        let worst = max(&self.deductible_mult_bps) * max(&self.validity_mult_bps) / 10_000 * max(&self.flex_window_mult_bps) / 10_000
            * self.airport_group_mult_bps as u128
            / 10_000;
        if worst > 100_000 || self.base_table.iter().flatten().any(|b| *b > 1_000_000) {
            return Err("option multipliers combined must stay within 10x and base prices within EUR 10,000");
        }
        Ok(())
    }
}

impl Params {
    pub fn product(&self, p: crate::Product) -> &ProductParams {
        match p {
            crate::Product::Cap => &self.cap,
            crate::Product::Drop => &self.drop,
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        self.cap.validate()?;
        self.drop.validate()?;
        let g = &self.global;
        if g.protocol_fee_bps > 5_000 {
            return Err("protocol fee above 50%");
        }
        if g.usdc_micro_per_cent == 0 {
            return Err("usdc_micro_per_cent must be positive");
        }
        if g.max_quote_snapshot_age_secs == 0 || g.max_index_snapshot_age_secs == 0 || g.max_attestation_age_secs == 0 {
            return Err("age limits must be positive");
        }
        Ok(())
    }

    /// Example parameters for unit tests only. Real values come from
    /// `backtest/output/premium_params.json`.
    pub fn example() -> Self {
        let product = |base: u64, deductible: u64, max_payout: u64, delay: u64| ProductParams {
            price_bucket_bounds: vec![10_000, 20_000, 35_000],
            dtd_bucket_bounds: vec![7, 21, 60],
            base_table: vec![
                vec![base * 6 / 10, base * 8 / 10, base, base * 9 / 10],
                vec![base * 7 / 10, base, base * 12 / 10, base],
                vec![base * 8 / 10, base * 12 / 10, base * 14 / 10, base * 12 / 10],
                vec![base, base * 14 / 10, base * 16 / 10, base * 14 / 10],
            ],
            momentum_mult_bps: [8_000, 9_000, 10_000, 12_500, 15_000],
            availability_mult_bps: [9_000, 10_000, 11_000, 13_000, 16_000],
            season_mult_bps: 11_500,
            util_kink_bps: 6_000,
            util_slope_bps: 10_000,
            flight_slope_bps: 3_000,
            moneyness_slope_bps: 40_000,
            moneyness_floor_bps: 2_500,
            min_premium: 300,
            max_premium: 3_500,
            deductible,
            max_payout,
            validity_secs: 7 * 86_400,
            deductible_options: vec![deductible, deductible * 2, deductible * 5],
            deductible_mult_bps: vec![10_000, 8_600, 6_200],
            validity_options_secs: vec![3 * 86_400, 7 * 86_400, 14 * 86_400, 30 * 86_400],
            validity_mult_bps: vec![6_400, 10_000, 14_800, 22_500],
            flex_window_mult_bps: [10_000, 10_600, 11_100, 11_500],
            airport_group_mult_bps: 10_400,
            activation_delay_secs: delay,
            flight_exposure_cap: 2_000_000,
            route_week_exposure_cap: 5_000_000,
            max_per_user_per_flight: 2,
            max_per_user_per_day: 5,
            purchase_window_secs: 86_400,
            min_secs_before_departure: 2 * 86_400,
        };
        Params {
            global: GlobalParams {
                max_quote_snapshot_age_secs: 3_600,
                max_index_snapshot_age_secs: 6 * 3_600,
                max_attestation_age_secs: 3_600,
                final_check_lead_secs: 86_400,
                claim_grace_secs: 3 * 86_400,
                free_cancel_window_secs: 86_400,
                sold_out_premium_refund: true,
                protocol_fee_bps: 500,
                usdc_micro_per_cent: 10_800,
                param_timelock_secs: 2 * 86_400,
            },
            cap: product(900, 1_000, 10_000, 86_400),
            drop: product(600, 500, 6_000, 0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn example_params_validate() {
        Params::example().validate().unwrap();
    }
    #[test]
    fn json_roundtrip() {
        let p = Params::example();
        let s = near_sdk::serde_json::to_string(&p).unwrap();
        let q: Params = near_sdk::serde_json::from_str(&s).unwrap();
        assert_eq!(p, q);
    }
}
