"""Calibrates the public premium parameters from simulated (or real) data and searches
for a parameter set that keeps the vaults profitable with acceptable consumer prices."""
from __future__ import annotations

import copy
import itertools

import numpy as np

from .formula import cap_payout, drop_payout
from .simulate import BuyerConfig, simulate_cap, simulate_drop, summarize

DAY = 86_400
# Choices offered to buyers (per traveller, cents). The default deductible from the search is
# always included; options at or above the maximum payout are dropped.
DEDUCTIBLE_MENU = {"cap": [500, 1_000, 2_500, 5_000], "drop": [300, 1_000, 2_500]}
DURATION_MENU = [3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY]

PRICE_BOUNDS = [10_000, 20_000, 35_000]
DTD_BOUNDS = [7, 21, 60]


def skeleton(product: str, deductible: int, max_payout: int) -> dict:
    flat = [[500] * (len(DTD_BOUNDS) + 1) for _ in range(len(PRICE_BOUNDS) + 1)]
    return {
        "price_bucket_bounds": PRICE_BOUNDS,
        "dtd_bucket_bounds": DTD_BOUNDS,
        "base_table": flat,
        "momentum_mult_bps": [10_000] * 5,
        "availability_mult_bps": [10_000] * 5,
        "season_mult_bps": 10_000,
        "util_kink_bps": 6_000,
        "util_slope_bps": 10_000,
        "flight_slope_bps": 2_000,
        "moneyness_slope_bps": 0 if product == "drop" else 40_000,
        "moneyness_floor_bps": 2_500,
        "min_premium": 300,
        "max_premium": min(4_000, max_payout - 100),
        "deductible": deductible,
        "max_payout": max_payout,
        "validity_secs": 7 * 86_400,
        # Neutral options during the search; finalize_options() calibrates the menus.
        "deductible_options": [deductible],
        "deductible_mult_bps": [10_000],
        "validity_options_secs": [7 * 86_400],
        "validity_mult_bps": [10_000],
        "flex_window_mult_bps": [10_000] * 4,
        "airport_group_mult_bps": 10_000,
        "activation_delay_secs": 86_400 if product == "cap" else 0,
        "flight_exposure_cap": max_payout * 40,
        "route_week_exposure_cap": max_payout * 400,
        "max_per_user_per_flight": 2,
        "max_per_user_per_day": 5,
        "purchase_window_secs": 86_400,
        "min_secs_before_departure": 2 * 86_400,
    }


def _ratio_mult(recs, key, overall, lo=0.7, hi=2.5, shrink=30, monotone=True) -> list[int]:
    out = []
    for b in range(5):
        xs = [r.payout for r in recs if getattr(r, key) == b]
        n = len(xs)
        m = (np.mean(xs) if n else overall)
        ratio = (n * (m / max(overall, 1e-9)) + shrink * 1.0) / (n + shrink)
        out.append(float(np.clip(ratio, lo, hi)))
    if monotone:
        out = list(np.maximum.accumulate(out))
    return [int(round(x * 10_000)) for x in out]


def calibrate(product: str, flights, deductible: int, max_payout: int, target_lr: float,
              cfg: BuyerConfig, sold_out_refund: bool = True) -> dict:
    """Fits multipliers and the base table so that premium ~ expected payout / target_lr."""
    p = skeleton(product, deductible, max_payout)
    # Neutral pricing run to observe payouts. Reference buyers: uninformed mix.
    ref_cfg = copy.copy(cfg)
    sim = simulate_cap if product == "cap" else simulate_drop
    recs = sim(flights, p, ref_cfg, seed=11)
    if not recs:
        return p
    overall = np.mean([r.payout for r in recs])
    p["momentum_mult_bps"] = _ratio_mult(recs, "momentum", overall, monotone=(product == "cap"))
    if product == "drop":
        # Falling prices (low momentum) are the risk for drops: enforce decreasing.
        m = [x / 10_000 for x in _ratio_mult(recs, "momentum", overall, monotone=False)]
        m = list(np.minimum.accumulate(m))
        p["momentum_mult_bps"] = [int(round(x * 10_000)) for x in m]
    p["availability_mult_bps"] = _ratio_mult(recs, "availability", overall, monotone=(product == "cap"))
    s = [r.payout for r in recs if r.season]
    ns = [r.payout for r in recs if not r.season]
    if s and ns:
        p["season_mult_bps"] = int(round(float(np.clip(np.mean(s) / max(np.mean(ns), 1e-9), 0.8, 2.0)) * 10_000))
    # Moneyness: payout vs cap distance (cap only), least squares on a linear decay.
    if product == "cap":
        atm = np.mean([r.payout for r in recs if r.otm == 0.0] or [overall])
        xs, ys = [], []
        for o in sorted(set(r.otm for r in recs)):
            if o == 0:
                continue
            v = np.mean([r.payout for r in recs if r.otm == o])
            xs.append(o)
            ys.append(v / max(atm, 1e-9))
        if xs:
            xs, ys = np.array(xs), np.array(ys)
            slope = float(np.clip(np.sum(xs * (1 - ys)) / np.sum(xs * xs), 0.5, 8.0))
            p["moneyness_slope_bps"] = int(round(slope * 10_000))
            p["moneyness_floor_bps"] = int(round(float(np.clip(ys.min() * 0.9, 0.1, 0.6)) * 10_000))
    # Base table: expected payout per cell, net of the signal and moneyness multipliers.
    def adj(r):
        m = p["momentum_mult_bps"][r.momentum] / 1e4 * p["availability_mult_bps"][r.availability] / 1e4
        m *= p["season_mult_bps"] / 1e4 if r.season else 1.0
        if product == "cap":
            otm_bps = max(0, r.strike - r.price) * 10_000 // r.price
            m *= max(p["moneyness_floor_bps"], 10_000 - otm_bps * p["moneyness_slope_bps"] // 10_000) / 1e4
        return m
    rows, cols = len(PRICE_BOUNDS) + 1, len(DTD_BOUNDS) + 1
    table = np.zeros((rows, cols))
    global_base = np.mean([r.payout / adj(r) for r in recs])
    for i in range(rows):
        for j in range(cols):
            cell = [r.payout / adj(r) for r in recs if r.price_bucket == i and r.dtd_bucket == j]
            n = len(cell)
            m = np.mean(cell) if n else global_base
            table[i, j] = (n * m + 50 * global_base) / (n + 50)
    table = table / target_lr
    p["base_table"] = [[int(max(100, round(x))) for x in row] for row in table]
    return p


def evaluate(product, flights, p, cfg, seed=21):
    sim = simulate_cap if product == "cap" else simulate_drop
    return summarize(sim(flights, p, cfg, seed=seed), cfg.protocol_fee_bps)


def search(product: str, flights, cfg: BuyerConfig, consumer_max_eur: float = 10.0, log=print) -> tuple[dict, dict, list]:
    """Grid over deductible, max payout and target loss ratio; picks the set with the
    highest vault return (at the configured informed share) whose median premium on
    tickets <= €300 is under the consumer threshold. Ties favour larger max payouts."""
    if product == "cap":
        grid = itertools.product([500, 1_000, 1_500], [6_000, 10_000, 15_000], [0.55, 0.65, 0.75])
    else:
        grid = itertools.product([300, 500, 1_000], [4_000, 6_000, 8_000], [0.55, 0.65, 0.75])
    results = []
    for ded, mp, lr in grid:
        p = calibrate(product, flights, ded, mp, lr, cfg)
        s = evaluate(product, flights, p, cfg)
        ok = s["median_premium_le_300_eur"] <= consumer_max_eur and s["vault_return_on_premium"] > 0.05
        results.append({"deductible": ded, "max_payout": mp, "target_lr": lr, "ok": ok,
                        "median_le_300": s["median_premium_le_300_eur"], "return": s["vault_return_on_premium"],
                        "loss_ratio": s["loss_ratio"], "params": p})
        log(f"  {product} ded={ded/100:>5.0f} max={mp/100:>5.0f} lr={lr:.2f} -> median≤300 €{s['median_premium_le_300_eur']:.2f}"
            f" LR {s['loss_ratio']:.2f} return {s['vault_return_on_premium']:+.2f} {'OK' if ok else ''}")
    oks = [r for r in results if r["ok"]] or results
    best = max(oks, key=lambda r: (round(r["return"], 2) >= 0.15, r["max_payout"], -r["deductible"], r["return"]))
    return best["params"], best, results


def _payout_with(r, product: str, deductible: int, max_payout: int) -> int:
    m = r.meta
    if product == "cap" and "index" in m:
        return cap_payout(m["index"], m["paid"], r.strike, deductible, max_payout)
    if product == "drop" and "lowest" in m:
        return drop_payout(m["paid"], m["lowest"], deductible, max_payout)
    return 0


def finalize_options(product: str, flights, p: dict, cfg: BuyerConfig, log=print) -> dict:
    """Calibrates the buyer menus on top of the chosen parameters.

    Deductible: each simulated policy's payout is recomputed with every deductible on the menu;
    the multiplier is the expected payout relative to the default deductible (so the loss ratio
    stays the same), never increasing with the deductible.
    Duration: the simulation is re-run with each cover duration; the multiplier is the expected
    payout per policy relative to 7 days, never decreasing with the duration. This is the
    duration dimension of the base table, kept separable so the 2-D table stays readable."""
    p = copy.deepcopy(p)
    sim = simulate_cap if product == "cap" else simulate_drop
    recs = sim(flights, p, cfg, seed=11)
    menu = sorted({d for d in DEDUCTIBLE_MENU[product] if d < p["max_payout"]} | {p["deductible"]})
    base = np.mean([_payout_with(r, product, p["deductible"], p["max_payout"]) for r in recs]) or 1e-9
    ratios = [np.mean([_payout_with(r, product, d, p["max_payout"]) for r in recs]) / base for d in menu]
    ratios = np.minimum.accumulate(np.clip(ratios, 0.15, 1.5))
    i0 = menu.index(p["deductible"])
    ratios = ratios / ratios[i0]
    p["deductible_options"] = menu
    p["deductible_mult_bps"] = [int(round(float(x) * 10_000)) for x in ratios]
    means = []
    for v in DURATION_MENU:
        q = copy.deepcopy(p)
        q["validity_secs"] = v
        q["validity_options_secs"] = [v]
        q["validity_mult_bps"] = [10_000]
        rs = sim(flights, q, cfg, seed=11)
        means.append(np.mean([r.payout for r in rs]) if rs else 0.0)
    ref = means[DURATION_MENU.index(7 * DAY)] or 1e-9
    durs = np.maximum.accumulate(np.clip(np.array(means) / ref, 0.25, 3.0))
    durs = durs / durs[DURATION_MENU.index(7 * DAY)]
    p["validity_secs"] = 7 * DAY
    p["validity_options_secs"] = list(DURATION_MENU)
    p["validity_mult_bps"] = [int(round(float(x) * 10_000)) for x in durs]
    log(f"  {product} deductibles {[d / 100 for d in menu]} -> x{[round(float(x), 2) for x in ratios]}; "
        f"durations 3/7/14/30 days -> x{[round(float(x), 2) for x in durs]}")
    return p
