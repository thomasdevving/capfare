"""Policy-sale simulation with realistic buyer selection.

Buyer models
  uninformed   buys at a random time, books at a random time in the window
  informed     buys only when momentum/availability signals are high (e.g. a group
               watching a nearly full flight) and books at the worst moment for the vault
  breakage     a share of buyers never books (no payout)
  cancellers   a share of refundable bookings is cancelled before departure; the final
               status check voids those payouts
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .data import STEPS_PER_DAY, HORIZON_DAYS, FlightPath
from .formula import PremiumError, PremiumInputs, cap_payout, compute_premium, drop_payout

DAY = 86_400


@dataclass
class BuyerConfig:
    buyers_per_flight: float = 4.0
    informed_share: float = 0.25
    breakage_uninformed: float = 0.30
    breakage_informed: float = 0.10
    refundable_share: float = 0.20
    cancel_prob_refundable: float = 0.35
    otm_choices: tuple = (0.0, 0.05, 0.10, 0.15)
    otm_probs: tuple = (0.15, 0.40, 0.30, 0.15)
    assumed_utilization: float = 0.30
    sold_out_refund: bool = True
    protocol_fee_bps: int = 500


@dataclass
class PolicyRecord:
    product: str
    flight_id: str
    route: str
    week: int
    informed: bool
    price: int
    strike: int
    premium: int
    payout: int
    max_payout: int
    booked: bool
    refunded: bool
    dtd_bucket: int
    price_bucket: int
    momentum: int
    availability: int
    season: bool
    otm: float
    days_to_departure: int
    meta: dict = field(default_factory=dict)


def _ts(fp: FlightPath, t: int) -> int:
    return int(round((HORIZON_DAYS - fp.dtd[t]) * DAY))


def _quote(p: dict, product: str, fp: FlightPath, t: int, strike: int, flight_exposure: int, cfg: BuyerConfig):
    total = 10**12
    new_lock = p["max_payout"] * 10_800
    locked = max(0, int(total * cfg.assumed_utilization) - new_lock)
    return compute_premium(p, PremiumInputs(
        product=product, current_price=int(fp.price[t]), strike=strike,
        momentum_bucket=fp.momentum_bucket(t), availability_bucket=fp.availability_bucket(t),
        season_flag=fp.season, now=_ts(fp, t), departure_ts=HORIZON_DAYS * DAY,
        vault_total_assets=total, vault_locked=locked, vault_reserved=0, new_lock=new_lock,
        flight_exposure=flight_exposure))


def simulate_cap(flights: list[FlightPath], p: dict, cfg: BuyerConfig, seed: int = 1) -> list[PolicyRecord]:
    rng = np.random.default_rng(seed)
    out: list[PolicyRecord] = []
    delay = int(np.ceil(p["activation_delay_secs"] / DAY * STEPS_PER_DAY))
    validity = int(p["validity_secs"] / DAY * STEPS_PER_DAY)
    min_steps_left = int(np.ceil(p["min_secs_before_departure"] / DAY * STEPS_PER_DAY))
    for fp in flights:
        exposure = 0
        T = fp.steps
        first = int((HORIZON_DAYS - 90) * STEPS_PER_DAY)
        last = T - min_steps_left - 1
        for _ in range(rng.poisson(cfg.buyers_per_flight)):
            informed = rng.random() < cfg.informed_share
            t = int(rng.integers(first, last))
            if informed:
                cands = [s for s in range(t, min(t + 14 * STEPS_PER_DAY, last))
                         if fp.momentum_bucket(s) >= 3 or fp.availability_bucket(s) >= 3]
                if not cands:
                    continue
                t = cands[0]
            if not fp.available[t] or exposure + p["max_payout"] > p["flight_exposure_cap"]:
                continue
            otm = 0.0 if informed and rng.random() < 0.5 else float(rng.choice(cfg.otm_choices, p=cfg.otm_probs))
            price = int(fp.price[t])
            strike = int(np.ceil(price * (1 + otm) / 100.0)) * 100
            try:
                q = _quote(p, "cap", fp, t, strike, exposure, cfg)
            except PremiumError:
                continue
            exposure += p["max_payout"]
            premium = q["premium"]
            start, end = t + delay, min(t + validity, T - 1)
            booked = False
            payout = 0
            refunded = False
            breakage = cfg.breakage_informed if informed else cfg.breakage_uninformed
            if start <= end and rng.random() >= breakage:
                window = np.arange(start, end + 1)
                avail = window[fp.available[window]]
                if len(avail):
                    b = int(avail[np.argmax(fp.price[avail])]) if informed else int(rng.choice(avail))
                    index = int(fp.price[b])
                    paid = int(round(index * rng.uniform(0.97, 1.03)))
                    refundable = rng.random() < cfg.refundable_share
                    cancelled = refundable and rng.random() < cfg.cancel_prob_refundable
                    booked = True
                    if not cancelled:
                        payout = cap_payout(index, paid, strike, p["deductible"], p["max_payout"])
            if not booked and cfg.sold_out_refund:
                w = np.arange(t, end + 1)
                if (~fp.available[w]).any():
                    refunded = True
                    premium = 0
            out.append(PolicyRecord("cap", fp.flight_id, fp.route, (fp.departure_day - int(fp.dtd[t])) // 7, informed,
                                    price, strike, premium, payout, p["max_payout"], booked, refunded, q["dtd_bucket"],
                                    q["price_bucket"], fp.momentum_bucket(t), fp.availability_bucket(t), fp.season, otm,
                                    q["days_to_departure"]))
    return out


def simulate_drop(flights: list[FlightPath], p: dict, cfg: BuyerConfig, seed: int = 2) -> list[PolicyRecord]:
    rng = np.random.default_rng(seed)
    out: list[PolicyRecord] = []
    validity = int(p["validity_secs"] / DAY * STEPS_PER_DAY)
    min_steps_left = int(np.ceil(p["min_secs_before_departure"] / DAY * STEPS_PER_DAY))
    for fp in flights:
        exposure = 0
        T = fp.steps
        first = int((HORIZON_DAYS - 90) * STEPS_PER_DAY)
        last = T - min_steps_left - 1
        for _ in range(rng.poisson(cfg.buyers_per_flight)):
            informed = rng.random() < cfg.informed_share
            b = int(rng.integers(first, last))
            if informed:
                cands = [s for s in range(b, min(b + 14 * STEPS_PER_DAY, last)) if fp.momentum_bucket(s) <= 1]
                if not cands:
                    continue
                b = cands[0]
            if not fp.available[b] or exposure + p["max_payout"] > p["flight_exposure_cap"]:
                continue
            price = int(fp.price[b])
            paid = int(round(price * rng.uniform(0.98, 1.0)))
            if price < paid:  # purchase refused: price already below what was paid
                continue
            try:
                q = _quote(p, "drop", fp, b, paid, exposure, cfg)
            except PremiumError:
                continue
            exposure += p["max_payout"]
            end = min(b + validity, T - 1)
            window = np.arange(b, end + 1)
            avail = window[fp.available[window]]
            lowest = int(fp.price[avail].min()) if len(avail) else paid
            refundable = rng.random() < cfg.refundable_share
            cancelled = refundable and rng.random() < cfg.cancel_prob_refundable
            payout = 0 if cancelled else drop_payout(paid, lowest, p["deductible"], p["max_payout"])
            out.append(PolicyRecord("drop", fp.flight_id, fp.route, (fp.departure_day - int(fp.dtd[b])) // 7, informed,
                                    price, paid, q["premium"], payout, p["max_payout"], True, False, q["dtd_bucket"],
                                    q["price_bucket"], fp.momentum_bucket(b), fp.availability_bucket(b), fp.season, 0.0,
                                    q["days_to_departure"]))
    return out


def summarize(recs: list[PolicyRecord], fee_bps: int = 500, consumer_ticket_max: int = 30_000) -> dict:
    if not recs:
        return {"policies": 0}
    prem = np.array([r.premium for r in recs], dtype=float)
    pay = np.array([r.payout for r in recs], dtype=float)
    net = prem * (1 - fee_bps / 10_000)
    pnl = net - pay
    weeks: dict[int, float] = {}
    for r, x in zip(recs, pnl):
        weeks[r.week] = weeks.get(r.week, 0.0) + x
    wk = np.array(sorted(weeks.items()))[:, 1]
    months = [wk[i:i + 4].sum() for i in range(0, len(wk), 4)]
    sold = [r for r in recs if r.premium > 0]
    cheap = [r.premium for r in sold if r.price <= consumer_ticket_max]
    return {
        "policies": len(recs),
        "premium_total_eur": prem.sum() / 100,
        "payout_total_eur": pay.sum() / 100,
        "loss_ratio": float(pay.sum() / max(prem.sum(), 1)),
        "vault_return_on_premium": float(pnl.sum() / max(prem.sum(), 1)),
        "pnl_per_policy_eur": float(pnl.mean() / 100),
        "claim_rate": float((pay > 0).mean()),
        "median_premium_eur": float(np.median([r.premium for r in sold]) / 100) if sold else 0.0,
        "median_premium_le_300_eur": float(np.median(cheap) / 100) if cheap else 0.0,
        "p90_premium_eur": float(np.percentile([r.premium for r in sold], 90) / 100) if sold else 0.0,
        "break_even_premium_over_max_payout": float(pay.mean() / max(np.mean([r.max_payout for r in recs]), 1)),
        "avg_premium_over_max_payout": float(prem.mean() / max(np.mean([r.max_payout for r in recs]), 1)),
        "worst_week_eur": float(wk.min() / 100),
        "worst_month_eur": float(min(months) / 100),
        "weeks": len(wk),
        "weekly_pnl_eur": (wk / 100).tolist(),
        "pnl_per_policy_dist_eur": (pnl / 100).tolist(),
    }


def required_capital(recs: list[PolicyRecord], policies_per_week: int, ruin_prob: float = 0.01,
                     horizon_weeks: int = 52, trials: int = 2000, seed: int = 3, fee_bps: int = 500) -> dict:
    """Capital needed (beyond full collateralisation of live policies) so that cumulative
    losses over `horizon_weeks` exceed it with probability <= ruin_prob, by bootstrap."""
    rng = np.random.default_rng(seed)
    pnl = np.array([r.premium * (1 - fee_bps / 10_000) - r.payout for r in recs], dtype=float) / 100
    mp = np.mean([r.max_payout for r in recs]) / 100
    draws = rng.choice(pnl, size=(trials, horizon_weeks, policies_per_week)).sum(axis=2)
    cum = draws.cumsum(axis=1)
    worst = np.minimum(cum.min(axis=1), 0)
    k = float(-np.quantile(worst, ruin_prob))
    # Full collateralisation: ~1 week of sales are live at once (7-day validity).
    collateral = policies_per_week * mp
    return {"policies_per_week": policies_per_week, "ruin_prob": ruin_prob, "loss_buffer_eur": k,
            "collateral_eur": float(collateral), "total_capital_eur": float(collateral + k),
            "p_loss_after_year": float((cum[:, -1] < 0).mean())}
