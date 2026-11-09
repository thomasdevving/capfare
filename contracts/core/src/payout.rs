//! Payout rules (section 5 of the brief). Implemented exactly and property-tested.

use crate::types::Cents;

/// Price Cap: clamp(min(index_at_booking, paid) - strike - deductible, 0, max_payout).
pub fn cap_payout(index_at_booking: Cents, paid: Cents, strike: Cents, deductible: Cents, max_payout: Cents) -> Cents {
    index_at_booking
        .min(paid)
        .saturating_sub(strike)
        .saturating_sub(deductible)
        .min(max_payout)
}

/// Drop Guarantee: clamp(paid - lowest_price_seen - deductible, 0, max_payout).
pub fn drop_payout(paid: Cents, lowest_price_seen: Cents, deductible: Cents, max_payout: Cents) -> Cents {
    paid.saturating_sub(lowest_price_seen)
        .saturating_sub(deductible)
        .min(max_payout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn demo_numbers() {
        // Brief section 13: cap €180, index €260, paid €255, deductible €10, max €100.
        assert_eq!(cap_payout(26_000, 25_500, 18_000, 1_000, 10_000), 6_500);
        // Drop: paid €220, lowest €195, deductible €5, max €60.
        assert_eq!(drop_payout(22_000, 19_500, 500, 6_000), 2_000);
        // Price fell below cap: nothing.
        assert_eq!(cap_payout(17_500, 17_500, 18_000, 1_000, 10_000), 0);
    }

    proptest! {
        #[test]
        fn cap_bounds(index in 0u64..1_000_000, paid in 0u64..1_000_000, strike in 0u64..1_000_000,
                      ded in 0u64..100_000, max in 0u64..100_000) {
            let p = cap_payout(index, paid, strike, ded, max);
            prop_assert!(p <= max);
            // Never pays more than the real overpayment vs the cap.
            prop_assert!(p <= index.min(paid).saturating_sub(strike));
            // Paying less (or index lower) never increases the payout.
            prop_assert!(cap_payout(index, paid.saturating_sub(1), strike, ded, max) <= p);
            prop_assert!(cap_payout(index.saturating_sub(1), paid, strike, ded, max) <= p);
            // Exact formula when uncapped.
            let raw = index.min(paid) as i128 - strike as i128 - ded as i128;
            let expect = raw.clamp(0, max as i128) as u64;
            prop_assert_eq!(p, expect);
        }

        #[test]
        fn drop_bounds(paid in 0u64..1_000_000, low in 0u64..1_000_000, ded in 0u64..100_000, max in 0u64..100_000) {
            let p = drop_payout(paid, low, ded, max);
            prop_assert!(p <= max);
            prop_assert!(p <= paid.saturating_sub(low));
            let raw = paid as i128 - low as i128 - ded as i128;
            prop_assert_eq!(p, raw.clamp(0, max as i128) as u64);
            // A lower observed price never lowers the payout.
            prop_assert!(drop_payout(paid, low.saturating_sub(1), ded, max) >= p);
        }
    }
}
