//! Public premium formula (section 6 of the brief), integer-only.
//!
//! premium = clamp(ceil(base * mom * avail * season * util * moneyness * options / 10_000^6),
//!                 min_premium, max_premium)
//!
//! `options` combines the buyer's choices: deductible, cover duration and, for route cover,
//! the date window and airport groups (floor(ded * dur / 10_000 * flex / 10_000)).

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
    /// Chosen deductible per traveller (cents); None = the product's default.
    #[serde(default)]
    pub deductible: Option<Cents>,
    /// Chosen cover duration (seconds); None = the product's default.
    #[serde(default)]
    pub validity_secs: Option<u64>,
    /// Route cover only: the date window in days either side (0..=3). None = one exact flight.
    #[serde(default)]
    pub route_window_days: Option<u8>,
    /// Route cover only: either end is an airport group.
    #[serde(default)]
    pub airport_group: bool,
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
    pub deductible_mult_bps: u32,
    pub validity_mult_bps: u32,
    pub flex_mult_bps: u32,
    pub options_mult_bps: u32,
    pub deductible: Cents,
    pub validity_secs: u64,
    pub max_payout: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PremiumError {
    AlreadyDeparted,
    TooCloseToDeparture,
    StrikeBelowPrice,
    ZeroPrice,
    NoLiquidity,
    UnknownDeductible,
    UnknownDuration,
    BadDateWindow,
}

impl PremiumError {
    pub fn msg(&self) -> &'static str {
        match self {
            PremiumError::AlreadyDeparted => "flight has departed",
            PremiumError::TooCloseToDeparture => "too close to departure",
            PremiumError::StrikeBelowPrice => "cap must be at or above the current price",
            PremiumError::ZeroPrice => "price must be positive",
            PremiumError::NoLiquidity => "vault has no assets",
            PremiumError::UnknownDeductible => "choose one of the offered deductibles",
            PremiumError::UnknownDuration => "choose one of the offered cover durations",
            PremiumError::BadDateWindow => "date window must be 0 to 3 days",
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

/// Premium multiplier for the buyer's choices (see the module docs).
pub fn options_mult_bps(p: &ProductParams, i: &PremiumInputs) -> Result<(u128, u128, u128, u128, Cents, u64), PremiumError> {
    let deductible = i.deductible.unwrap_or(p.deductible);
    let validity = i.validity_secs.unwrap_or(p.validity_secs);
    let di = p.deductible_options.iter().position(|d| *d == deductible).ok_or(PremiumError::UnknownDeductible)?;
    let vi = p.validity_options_secs.iter().position(|v| *v == validity).ok_or(PremiumError::UnknownDuration)?;
    let ded = p.deductible_mult_bps[di] as u128;
    let dur = p.validity_mult_bps[vi] as u128;
    let flex = match i.route_window_days {
        None => BPS,
        Some(w) if w as usize >= p.flex_window_mult_bps.len() => return Err(PremiumError::BadDateWindow),
        Some(w) => {
            let group = if i.airport_group { p.airport_group_mult_bps as u128 } else { BPS };
            (p.flex_window_mult_bps[w as usize] as u128) * group / BPS
        }
    };
    let opt = ded * dur / BPS * flex / BPS;
    Ok((ded, dur, flex, opt, deductible, validity))
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
    let (ded, dur, flex, opt, deductible, validity) = options_mult_bps(p, i)?;

    let num = (base as u128) * mom * avail * season * util * money * opt;
    let den = BPS.pow(6);
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
        deductible_mult_bps: ded as u32,
        validity_mult_bps: dur as u32,
        flex_mult_bps: flex as u32,
        options_mult_bps: opt as u32,
        deductible,
        validity_secs: validity,
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
            deductible: None,
            validity_secs: None,
            route_window_days: None,
            airport_group: false,
        }
    }

    #[test]
    fn options_change_the_premium_as_expected() {
        let p = Params::example();
        let base = compute_premium(&p.cap, &inputs(17_000, 18_000)).unwrap().unclamped;
        // A higher deductible costs less; a longer lock costs more; a date window costs more.
        let mut i = inputs(17_000, 18_000);
        i.deductible = Some(p.cap.deductible_options[2]);
        assert!(compute_premium(&p.cap, &i).unwrap().unclamped < base);
        let mut i = inputs(17_000, 18_000);
        i.validity_secs = Some(30 * 86_400);
        assert!(compute_premium(&p.cap, &i).unwrap().unclamped > base);
        let mut i = inputs(17_000, 18_000);
        i.route_window_days = Some(3);
        i.airport_group = true;
        assert!(compute_premium(&p.cap, &i).unwrap().unclamped > base);
        // Only offered options are accepted.
        let mut i = inputs(17_000, 18_000);
        i.deductible = Some(123);
        assert_eq!(compute_premium(&p.cap, &i), Err(PremiumError::UnknownDeductible));
        let mut i = inputs(17_000, 18_000);
        i.validity_secs = Some(86_400);
        assert_eq!(compute_premium(&p.cap, &i), Err(PremiumError::UnknownDuration));
        let mut i = inputs(17_000, 18_000);
        i.route_window_days = Some(4);
        assert_eq!(compute_premium(&p.cap, &i), Err(PremiumError::BadDateWindow));
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
        fn premium_monotone_in_options(price in 1_000u64..100_000, otm in 0u64..20_000, mom in 0u8..5, days in 3u64..300) {
            // A higher deductible never costs more; a longer cover never costs less.
            let p = Params::example();
            let mut i = inputs(price, price + otm);
            i.signals.momentum_bucket = mom;
            i.departure_ts = i.now + days * 86_400;
            let mut last = u64::MAX;
            for d in &p.cap.deductible_options {
                i.deductible = Some(*d);
                let x = compute_premium(&p.cap, &i).unwrap().unclamped;
                prop_assert!(x <= last);
                last = x;
            }
            i.deductible = None;
            let mut last = 0;
            for v in &p.cap.validity_options_secs {
                i.validity_secs = Some(*v);
                let x = compute_premium(&p.cap, &i).unwrap().unclamped;
                prop_assert!(x >= last);
                last = x;
            }
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
