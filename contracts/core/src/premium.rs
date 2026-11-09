//! Public premium formula (section 6 of the brief), integer-only.
//!
//! premium = clamp(ceil(base * mom * avail * season * util * moneyness / 10_000^5),
//!                 min_premium, max_premium)

use crate::math::BPS;
use crate::params::ProductParams;
use crate::types::{Cents, Product, Signals, Timestamp};
use near_sdk::json_types::U128;
use near_sdk::near;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PremiumInputs {
    pub product: Product,
    /// Current oracle price for the fare class, cents.
    pub current_price: Cents,
    /// Cap level (cap) or paid price (drop), cents.
    pub strike: Cents,
    pub signals: Signals,
    pub now: Timestamp,
    pub departure_ts: Timestamp,
    /// Vault figures in micro-USDC.
    pub vault_total_assets: U128,
    pub vault_locked: U128,
    pub vault_reserved: U128,
    /// Coverage this policy would lock, micro-USDC.
    pub new_lock: U128,
    /// Outstanding max payouts on this flight before the sale, cents.
    pub flight_exposure: Cents,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PremiumBreakdown {
    pub premium: Cents,
    pub unclamped: Cents,
    pub base: Cents,
    pub price_bucket: u32,
    pub dtd_bucket: u32,
    pub days_to_departure: u32,
    pub momentum_mult_bps: u32,
    pub availability_mult_bps: u32,
    pub season_mult_bps: u32,
    pub utilization_mult_bps: u32,
    pub moneyness_mult_bps: u32,
    pub utilization_bps: u32,
    pub flight_exposure_ratio_bps: u32,
    pub deductible: Cents,
    pub max_payout: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PremiumError {
    AlreadyDeparted,
    TooCloseToDeparture,
    StrikeBelowPrice,
    ZeroPrice,
    NoLiquidity,
}

impl PremiumError {
    pub fn msg(&self) -> &'static str {
        match self {
            PremiumError::AlreadyDeparted => "flight has departed",
            PremiumError::TooCloseToDeparture => "too close to departure",
            PremiumError::StrikeBelowPrice => "cap must be at or above the current price",
            PremiumError::ZeroPrice => "price must be positive",
            PremiumError::NoLiquidity => "vault has no assets",
        }
    }
}

/// Number of thresholds `v` is >= to (0..=len).
pub fn bucket_u64(v: u64, bounds: &[u64]) -> usize {
    bounds.iter().take_while(|b| v >= **b).count()
}

pub fn bucket_u32(v: u32, bounds: &[u32]) -> usize {
    bounds.iter().take_while(|b| v >= **b).count()
}

pub fn utilization_mult_bps(p: &ProductParams, util_bps: u128, flight_ratio_bps: u128) -> u128 {
    let over = util_bps.saturating_sub(p.util_kink_bps as u128);
    BPS + (p.util_slope_bps as u128) * over / BPS + (p.flight_slope_bps as u128) * flight_ratio_bps / BPS
}

pub fn moneyness_mult_bps(p: &ProductParams, product: Product, price: Cents, strike: Cents) -> u128 {
    match product {
        Product::Drop => BPS,
        Product::Cap => {
            let otm_bps = (strike.saturating_sub(price) as u128) * BPS / (price as u128);
            let dec = otm_bps * (p.moneyness_slope_bps as u128) / BPS;
            let adj = BPS.saturating_sub(dec);
            adj.max(p.moneyness_floor_bps as u128)
        }
    }
}

pub fn compute_premium(p: &ProductParams, i: &PremiumInputs) -> Result<PremiumBreakdown, PremiumError> {
    if i.current_price == 0 {
        return Err(PremiumError::ZeroPrice);
    }
    if i.departure_ts <= i.now {
        return Err(PremiumError::AlreadyDeparted);
    }
    if i.departure_ts - i.now < p.min_secs_before_departure {
        return Err(PremiumError::TooCloseToDeparture);
    }
    if i.product == Product::Cap && i.strike < i.current_price {
        return Err(PremiumError::StrikeBelowPrice);
    }
    let total = i.vault_total_assets.0;
    if total == 0 {
        return Err(PremiumError::NoLiquidity);
    }
    let days = ((i.departure_ts - i.now) / 86_400).min(u32::MAX as u64) as u32;
    let pb = bucket_u64(i.current_price, &p.price_bucket_bounds);
    let db = bucket_u32(days, &p.dtd_bucket_bounds);
    let base = p.base_table[pb][db];

    let mom = p.momentum_mult_bps[i.signals.momentum_bucket.min(4) as usize] as u128;
    let avail = p.availability_mult_bps[i.signals.availability_bucket.min(4) as usize] as u128;
    let season = if i.signals.season_flag { p.season_mult_bps as u128 } else { BPS };

    let used = i.vault_locked.0 + i.vault_reserved.0 + i.new_lock.0;
    let util_bps = (used * BPS / total).min(1_000_000);
    let flight_ratio_bps = ((i.flight_exposure as u128 + p.max_payout as u128) * BPS
        / (p.flight_exposure_cap.max(1) as u128))
        .min(1_000_000);
    let util = utilization_mult_bps(p, util_bps, flight_ratio_bps);
    let money = moneyness_mult_bps(p, i.product, i.current_price, i.strike);

    let num = (base as u128) * mom * avail * season * util * money;
    let den = BPS.pow(5);
    let unclamped = num / den + u128::from(num % den != 0);
    let unclamped = unclamped.min(u64::MAX as u128) as u64;
    let premium = crate::math::clamp_u64(unclamped, p.min_premium, p.max_premium);

    Ok(PremiumBreakdown {
        premium,
        unclamped,
        base,
        price_bucket: pb as u32,
        dtd_bucket: db as u32,
        days_to_departure: days,
        momentum_mult_bps: mom as u32,
        availability_mult_bps: avail as u32,
        season_mult_bps: season as u32,
        utilization_mult_bps: util.min(u32::MAX as u128) as u32,
        moneyness_mult_bps: money as u32,
        utilization_bps: util_bps as u32,
        flight_exposure_ratio_bps: flight_ratio_bps as u32,
        deductible: p.deductible,
        max_payout: p.max_payout,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use proptest::prelude::*;

    fn inputs(price: u64, strike: u64) -> PremiumInputs {
        PremiumInputs {
            product: Product::Cap,
            current_price: price,
            strike,
            signals: Signals { momentum_bucket: 2, availability_bucket: 1, season_flag: false },
            now: 1_000_000,
            departure_ts: 1_000_000 + 30 * 86_400,
            vault_total_assets: U128(1_000_000_000_000),
            vault_locked: U128(0),
            vault_reserved: U128(0),
            new_lock: U128(108_000_000),
            flight_exposure: 0,
        }
    }

    #[test]
    fn demo_quote_is_in_range() {
        let p = Params::example();
        let b = compute_premium(&p.cap, &inputs(17_000, 18_000)).unwrap();
        assert!(b.premium >= p.cap.min_premium && b.premium <= p.cap.max_premium);
        assert_eq!(b.price_bucket, 1);
        assert_eq!(b.dtd_bucket, 2);
    }

    #[test]
    fn rejects_strike_below_price() {
        let p = Params::example();
        assert_eq!(
            compute_premium(&p.cap, &inputs(17_000, 16_000)),
            Err(PremiumError::StrikeBelowPrice)
        );
    }

    #[test]
    fn rejects_departed_and_too_close() {
        let p = Params::example();
        let mut i = inputs(17_000, 18_000);
        i.departure_ts = i.now;
        assert_eq!(compute_premium(&p.cap, &i), Err(PremiumError::AlreadyDeparted));
        i.departure_ts = i.now + 3600;
        assert_eq!(compute_premium(&p.cap, &i), Err(PremiumError::TooCloseToDeparture));
    }

    proptest! {
        #[test]
        fn premium_always_clamped(price in 1u64..200_000, otm in 0u64..100_000,
            mom in 0u8..5, av in 0u8..5, season: bool, days in 2u64..400,
            locked in 0u128..1_000_000_000_000u128, fe in 0u64..2_000_000) {
            let p = Params::example();
            let mut i = inputs(price, price + otm);
            i.signals = Signals { momentum_bucket: mom, availability_bucket: av, season_flag: season };
            i.departure_ts = i.now + days * 86_400;
            i.vault_locked = U128(locked);
            i.flight_exposure = fe;
            let b = compute_premium(&p.cap, &i).unwrap();
            prop_assert!(b.premium >= p.cap.min_premium);
            prop_assert!(b.premium <= p.cap.max_premium);
        }

        #[test]
        fn premium_monotone_in_strike(price in 1_000u64..100_000, a in 0u64..50_000, b in 0u64..50_000) {
            // A higher cap never costs more.
            let p = Params::example();
            let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
            let x = compute_premium(&p.cap, &inputs(price, price + lo)).unwrap().premium;
            let y = compute_premium(&p.cap, &inputs(price, price + hi)).unwrap().premium;
            prop_assert!(y <= x);
        }

        #[test]
        fn premium_monotone_in_utilisation(l1 in 0u128..900_000_000_000u128, l2 in 0u128..900_000_000_000u128) {
            let p = Params::example();
            let (lo, hi) = if l1 <= l2 { (l1, l2) } else { (l2, l1) };
            let mut i = inputs(17_000, 18_000);
            i.vault_locked = U128(lo);
            let x = compute_premium(&p.cap, &i).unwrap().unclamped;
            i.vault_locked = U128(hi);
            let y = compute_premium(&p.cap, &i).unwrap().unclamped;
            prop_assert!(y >= x);
        }
    }
}
