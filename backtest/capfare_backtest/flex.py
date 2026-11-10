"""Backtest of route cover and flexible cover (date windows and airport groups). SYNTHETIC.

Route cover pays against an index: the cheapest available fare among a set of flights. This
module builds that index for sets of different sizes and checks what the single-flight pricing
does on it:

  window w   the flights on the route on the chosen day and w days either side (w = 0..3)
  group      also the flights from two nearby airports (an airport group such as AMS/RTM/EIN)

For every scenario (a route and a day) it generates the flights, aligns them on calendar time
(a flight one day later is one day further from departure at the same moment), takes the
cheapest available fare at each step as the index path, and runs the Price Cap buyer
simulation on that index with the single-flight parameters. The multiplier for a set is its
loss ratio relative to single-flight cover on the same scenarios, so the premium scales to
keep the loss ratio the same.
"""
from __future__ import annotations

import copy

import numpy as np

from .data import STEPS_PER_DAY, FlightPath, SyntheticSource
from .simulate import BuyerConfig, simulate_cap

FLIGHTS_PER_DAY = 4
NEARBY_AIRPORTS = 2  # an airport group = the main airport plus two nearby ones
MAX_WINDOW = 3


def _index_path(paths: list[tuple[FlightPath, int]], name: str) -> FlightPath:
    """Cheapest available fare per calendar step. `paths` holds (flight, day offset)."""
    ref = paths[0][0]
    T = ref.steps
    prices, avail, loads = [], [], []
    for fp, k in paths:
        # At calendar step t a flight departing k days later is at its own step t - 4k.
        idx = np.clip(np.arange(T) - k * STEPS_PER_DAY, 0, T - 1)
        prices.append(fp.price[idx].astype(np.float64))
        avail.append(fp.available[idx])
        loads.append(fp.load[idx])
    P, A, L = np.array(prices), np.array(avail), np.array(loads)
    open_price = np.where(A, P, np.inf)
    any_open = A.any(axis=0)
    price = np.where(any_open, open_price.min(axis=0), P.min(axis=0)).astype(np.int64)
    # Seat pressure: the least constrained open flight decides (as the oracle does).
    load = np.where(A, L, np.inf).min(axis=0)
    load = np.where(np.isfinite(load), load, L.min(axis=0))
    return FlightPath(name, ref.route, ref.season, ref.departure_day, ref.dtd, price, any_open, load)


def scenarios(n: int, seed: int = 31) -> list[dict]:
    """n route-days, each with flights on the day +/- MAX_WINDOW days at the main airport and
    at the nearby airports of its group."""
    src = SyntheticSource(seed=seed)
    rng = np.random.default_rng(seed)
    out = []
    for s in range(n):
        route_i = int(rng.integers(0, len(src.routes)))
        day = int(rng.integers(140, 460))
        flights = {}
        for airport in range(1 + NEARBY_AIRPORTS):
            for k in range(-MAX_WINDOW, MAX_WINDOW + 1):
                for j in range(FLIGHTS_PER_DAY):
                    # Nearby airports fly the same route market (same base fare level).
                    fp = src.flight(route_i, day + k)
                    fp.flight_id = f"S{s}A{airport}D{k}F{j}"
                    flights[(airport, k, j)] = fp
        out.append({"day": day, "flights": flights})
    return out


def index_for(sc: dict, window: int, group: bool) -> FlightPath:
    airports = range(1 + NEARBY_AIRPORTS) if group else range(1)
    paths = [(sc["flights"][(a, k, j)], k) for a in airports for k in range(-window, window + 1) for j in range(FLIGHTS_PER_DAY)]
    # The central day's first flight first: its timeline is the reference.
    paths.sort(key=lambda x: (x[1] != 0, abs(x[1])))
    return _index_path(paths, f"idx-w{window}-g{int(group)}")


def loss_ratio(paths: list[FlightPath], p: dict, cfg: BuyerConfig, seed: int) -> tuple[float, int]:
    recs = simulate_cap(paths, p, cfg, seed=seed)
    prem = sum(r.premium for r in recs)
    pay = sum(r.payout for r in recs)
    return (pay / prem if prem else 0.0), len(recs)


def calibrate_flex(cap_params: dict, cfg: BuyerConfig, n: int = 120, seed: int = 31, log=print) -> tuple[dict, dict]:
    """Returns (params with flex multipliers, report). Multipliers are clipped to 0.6..2.0."""
    scs = scenarios(n, seed)
    single = [sc["flights"][(0, 0, 0)] for sc in scs]
    lr_single, n_single = loss_ratio(single, cap_params, cfg, seed + 1)
    rows = []
    lr = {}
    for group in (False, True):
        for w in range(MAX_WINDOW + 1):
            idx = [index_for(sc, w, group) for sc in scs]
            v, cnt = loss_ratio(idx, cap_params, cfg, seed + 1)
            lr[(w, group)] = v
            rows.append({"window_days": w, "airport_group": group, "flights_in_set": FLIGHTS_PER_DAY * (2 * w + 1) * (1 + NEARBY_AIRPORTS * group),
                         "loss_ratio": round(v, 3), "policies": cnt})
    ref = lr_single or 1e-9
    window = [float(np.clip(lr[(w, False)] / ref, 0.6, 2.0)) for w in range(MAX_WINDOW + 1)]
    group_ratio = np.mean([lr[(w, True)] / max(lr[(w, False)], 1e-9) for w in range(MAX_WINDOW + 1)])
    group = float(np.clip(group_ratio, 0.6, 2.0))
    p = copy.deepcopy(cap_params)
    p["flex_window_mult_bps"] = [int(round(x * 10_000)) for x in window]
    p["airport_group_mult_bps"] = int(round(group * 10_000))
    report = {"scenarios": n, "single_flight_loss_ratio": round(lr_single, 3), "single_flight_policies": n_single, "sets": rows,
              "flex_window_mult": [round(x, 3) for x in window], "airport_group_mult": round(group, 3)}
    log(f"  route cover: single-flight LR {lr_single:.2f}; window 0..3 x{report['flex_window_mult']}, airport group x{report['airport_group_mult']}")
    return p, report
