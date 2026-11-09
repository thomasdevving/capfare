//! Rounding helpers. Rule of thumb used throughout CapFare:
//! amounts the user/LP *pays* or the vault *locks* round UP; amounts the vault
//! *pays out* round DOWN. Dust always stays in the vault.

pub const BPS: u128 = 10_000;

/// floor(a * b / c). Panics on c == 0 (callers validate).
pub fn mul_div_floor(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "division by zero");
    let p = a.checked_mul(b).expect("mul overflow");
    p / c
}

/// ceil(a * b / c).
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "division by zero");
    let p = a.checked_mul(b).expect("mul overflow");
    p / c + u128::from(p % c != 0)
}

pub fn clamp_u64(v: u64, lo: u64, hi: u64) -> u64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// Converts EUR cents to USDC micro-units at `usdc_micro_per_cent`, rounding UP
/// (used for premiums the user pays and coverage the vault locks).
pub fn cents_to_usdc_ceil(cents: u64, usdc_micro_per_cent: u64) -> u128 {
    u128::from(cents) * u128::from(usdc_micro_per_cent)
}

/// Converts EUR cents to USDC micro-units, rounding DOWN (payouts).
/// With an integer rate both directions are exact; the two functions exist so
/// that a future fractional rate keeps the rounding direction explicit.
pub fn cents_to_usdc_floor(cents: u64, usdc_micro_per_cent: u64) -> u128 {
    u128::from(cents) * u128::from(usdc_micro_per_cent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn ceil_ge_floor(a in 0u128..1u128<<60, b in 0u128..1u128<<60, c in 1u128..1u128<<60) {
            let f = mul_div_floor(a, b, c);
            let x = mul_div_ceil(a, b, c);
            prop_assert!(x >= f);
            prop_assert!(x - f <= 1);
            prop_assert!(f * c <= a * b);
            prop_assert!(x * c >= a * b);
        }
    }
}
