"""Price-path sources.

`SyntheticSource` produces fare paths with the typical patterns of airline revenue
management: an upward drift toward departure driven by fare-bucket closures, clustered
volatility (bucket changes come in bursts), short promotions, sell-outs of the cheapest
fare class, and seasonality. ALL RESULTS BASED ON IT ARE SYNTHETIC.

`CsvSource` loads real observations (one row per observation) for when historical data
is available: flight_id,route,season,departure_day,dtd_hours,price_cents,available
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

STEPS_PER_DAY = 4  # one observation every 6 hours
HORIZON_DAYS = 120


@dataclass
class FlightPath:
    flight_id: str
    route: str
    season: bool
    departure_day: int  # simulation day of departure (for weekly aggregation)
    dtd: np.ndarray  # days to departure per step (float, descending)
    price: np.ndarray  # cents (int64) of the covered fare class
    available: np.ndarray  # bool
    load: np.ndarray  # load factor 0..1 (used for the availability signal)
    synthetic: bool = True
    _signals: dict = field(default_factory=dict, repr=False)

    @property
    def steps(self) -> int:
        return len(self.price)

    def momentum_bucket(self, t: int) -> int:
        back = max(0, t - 2 * STEPS_PER_DAY)
        if back == t:
            return 2
        r = self.price[t] / self.price[back] - 1.0
        for i, th in enumerate((-0.08, -0.02, 0.02, 0.08)):
            if r < th:
                return i
        return 4

    def availability_bucket(self, t: int) -> int:
        l = self.load[t]
        for i, th in enumerate((0.5, 0.7, 0.85, 0.93)):
            if l < th:
                return i
        return 4


class SyntheticSource:
    LADDER = np.array([1.0, 1.15, 1.32, 1.52, 1.75, 2.0, 2.3])

    def __init__(self, seed: int = 7, routes: int = 40):
        self.rng = np.random.default_rng(seed)
        self.routes = [f"R{r:02d}" for r in range(routes)]
        self.route_base = {r: float(np.clip(self.rng.lognormal(np.log(140), 0.45), 45, 520)) for r in self.routes}

    def flight(self, idx: int, departure_day: int) -> FlightPath:
        rng = self.rng
        route = self.routes[idx % len(self.routes)]
        season = bool(((departure_day // 30) % 12) in (5, 6, 7, 11)) or rng.random() < 0.05
        base = self.route_base[route] * rng.uniform(0.85, 1.15)
        T = HORIZON_DAYS * STEPS_PER_DAY
        dtd = HORIZON_DAYS - np.arange(T) / STEPS_PER_DAY
        final_load = np.clip(rng.uniform(0.72, 0.99) + (0.05 if season else 0.0), 0, 1.0)
        half = rng.uniform(20, 45) * (0.8 if season else 1.0)
        k = rng.uniform(0.06, 0.12)
        load = final_load / (1 + np.exp(k * (dtd - half)))
        load = np.clip(load + rng.normal(0, 0.01, T).cumsum() * 0.05, 0, 1.0)
        load = np.maximum.accumulate(load)
        # Revenue-management level: driven by load and time, with bursty noise.
        level = np.zeros(T)
        noise = 0.0
        vol_state = 0.05
        for t in range(T):
            if rng.random() < 0.015:  # volatility regime switch (bursts of bucket changes)
                vol_state = 0.22 if vol_state < 0.1 else 0.05
            noise = 0.95 * noise + rng.normal(0, vol_state)
            late = max(0.0, (21 - dtd[t]) / 21)
            level[t] = 6.0 * max(0.0, load[t] - 0.35) / 0.65 + 2.2 * late + noise + (0.6 if season else 0.0)
        lvl = np.clip(np.round(level), 0, len(self.LADDER) - 1).astype(int)
        price = base * self.LADDER[lvl]
        # Promotions: occasional 1–3 day drops of 10–25%.
        promo = np.ones(T)
        t = 0
        while t < T:
            if rng.random() < 0.0015 and dtd[t] > 10:
                length = int(rng.integers(1, 4)) * STEPS_PER_DAY
                promo[t : t + length] = 1 - rng.uniform(0.10, 0.25)
                t += length
            t += 1
        price = price * promo * (1 + rng.normal(0, 0.005, T))
        price_cents = (np.round(price) * 100 - 1).astype(np.int64)  # e.g. 169.99
        sellout = rng.uniform(0.95, 1.0)
        available = (load < sellout) & (lvl < len(self.LADDER) - 1)
        return FlightPath(f"F{idx:05d}", route, season, departure_day, dtd, price_cents, available, load)

    def flights(self, n: int, days: int = 364) -> list[FlightPath]:
        return [self.flight(i, int(self.rng.integers(HORIZON_DAYS, HORIZON_DAYS + days))) for i in range(n)]


class CsvSource:
    """Real historical data. Rows must be sorted by flight and descending dtd."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def flights(self) -> list[FlightPath]:
        rows: dict[str, list[dict]] = {}
        with self.path.open() as f:
            for r in csv.DictReader(f):
                rows.setdefault(r["flight_id"], []).append(r)
        out = []
        for fid, rs in rows.items():
            dtd = np.array([float(r["dtd_hours"]) / 24 for r in rs])
            price = np.array([int(r["price_cents"]) for r in rs], dtype=np.int64)
            avail = np.array([r["available"] in ("1", "true", "True") for r in rs])
            # Without seat data, approximate load by the share of the path elapsed.
            load = np.linspace(0.3, 0.95, len(rs))
            out.append(FlightPath(fid, rs[0]["route"], rs[0]["season"] in ("1", "true"), int(rs[0]["departure_day"]),
                                  dtd, price, avail, load, synthetic=False))
        return out
