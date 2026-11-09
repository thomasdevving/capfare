"""Exact integer port of the on-chain premium and payout formulas (capfare-core).

Must stay bit-identical with contracts/core/src/premium.rs and payout.rs; the
conformance test in tests/test_formula.py checks shared vectors.
"""
from __future__ import annotations

from dataclasses import dataclass

BPS = 10_000


def bucket(v: int, bounds: list[int]) -> int:
    n = 0
    for b in bounds:
        if v >= b:
            n += 1
        else:
            break
    return n


@dataclass
class PremiumInputs:
    product: str  # "cap" | "drop"
    current_price: int
    strike: int
    momentum_bucket: int
    availability_bucket: int
    season_flag: bool
    now: int
    departure_ts: int
    vault_total_assets: int
    vault_locked: int
    vault_reserved: int
    new_lock: int
    flight_exposure: int


class PremiumError(Exception):
    pass


def utilization_mult_bps(p: dict, util_bps: int, flight_ratio_bps: int) -> int:
    over = max(0, util_bps - p["util_kink_bps"])
    return BPS + p["util_slope_bps"] * over // BPS + p["flight_slope_bps"] * flight_ratio_bps // BPS


def moneyness_mult_bps(p: dict, product: str, price: int, strike: int) -> int:
    if product == "drop":
        return BPS
    otm_bps = max(0, strike - price) * BPS // price
    dec = otm_bps * p["moneyness_slope_bps"] // BPS
    adj = max(0, BPS - dec)
    return max(adj, p["moneyness_floor_bps"])


def compute_premium(p: dict, i: PremiumInputs) -> dict:
    if i.current_price == 0:
        raise PremiumError("price must be positive")
    if i.departure_ts <= i.now:
        raise PremiumError("flight has departed")
    if i.departure_ts - i.now < p["min_secs_before_departure"]:
        raise PremiumError("too close to departure")
    if i.product == "cap" and i.strike < i.current_price:
        raise PremiumError("cap must be at or above the current price")
    if i.vault_total_assets == 0:
        raise PremiumError("vault has no assets")
    days = (i.departure_ts - i.now) // 86_400
    pb = bucket(i.current_price, p["price_bucket_bounds"])
    db = bucket(days, p["dtd_bucket_bounds"])
    base = p["base_table"][pb][db]
    mom = p["momentum_mult_bps"][min(i.momentum_bucket, 4)]
    av = p["availability_mult_bps"][min(i.availability_bucket, 4)]
    season = p["season_mult_bps"] if i.season_flag else BPS
    used = i.vault_locked + i.vault_reserved + i.new_lock
    util_bps = min(used * BPS // i.vault_total_assets, 1_000_000)
    flight_ratio_bps = min((i.flight_exposure + p["max_payout"]) * BPS // max(p["flight_exposure_cap"], 1), 1_000_000)
    util = utilization_mult_bps(p, util_bps, flight_ratio_bps)
    money = moneyness_mult_bps(p, i.product, i.current_price, i.strike)
    num = base * mom * av * season * util * money
    den = BPS**5
    unclamped = num // den + (1 if num % den else 0)
    premium = min(max(unclamped, p["min_premium"]), p["max_premium"])
    return {"premium": premium, "unclamped": unclamped, "base": base, "price_bucket": pb, "dtd_bucket": db,
            "days_to_departure": days, "utilization_mult_bps": util, "moneyness_mult_bps": money}


def cap_payout(index: int, paid: int, strike: int, deductible: int, max_payout: int) -> int:
    return min(max(min(index, paid) - strike - deductible, 0), max_payout)


def drop_payout(paid: int, lowest: int, deductible: int, max_payout: int) -> int:
    return min(max(paid - lowest - deductible, 0), max_payout)
