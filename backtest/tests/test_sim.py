import numpy as np

from capfare_backtest.calibrate import calibrate, evaluate
from capfare_backtest.cli import demo_variant, GLOBAL
from capfare_backtest.data import SyntheticSource
from capfare_backtest.simulate import BuyerConfig, simulate_cap, summarize


def flights(n=60):
    return SyntheticSource(seed=3).flights(n)


def test_synthetic_paths_have_expected_shape():
    fs = flights(40)
    late = np.mean([f.price[-20] / f.price[0] for f in fs])
    assert late > 1.1, "prices should drift up toward departure"
    assert any((~f.available).any() for f in fs), "some fare classes should sell out"
    assert all(f.synthetic for f in fs)


def test_informed_buyers_raise_loss_ratio():
    fs = flights(120)
    cfg = BuyerConfig(informed_share=0.0)
    p = calibrate("cap", fs, 1_000, 10_000, 0.7, cfg)
    s0 = evaluate("cap", fs, p, cfg)
    cfg2 = BuyerConfig(informed_share=0.8)
    s1 = evaluate("cap", fs, p, cfg2)
    assert s1["loss_ratio"] > s0["loss_ratio"]


def test_payouts_never_exceed_max():
    fs = flights(80)
    cfg = BuyerConfig()
    p = calibrate("cap", fs, 1_000, 10_000, 0.7, cfg)
    recs = simulate_cap(fs, p, cfg)
    assert all(0 <= r.payout <= r.max_payout for r in recs)
    s = summarize(recs)
    assert s["policies"] == len(recs)


def test_demo_variant_only_changes_timings():
    p = {"global": dict(GLOBAL), "cap": {"activation_delay_secs": 86_400, "x": 1}, "drop": {"validity_secs": 1, "purchase_window_secs": 1}}
    d = demo_variant(p)
    assert d["cap"]["x"] == 1 and d["cap"]["activation_delay_secs"] == 20
    assert p["cap"]["activation_delay_secs"] == 86_400
