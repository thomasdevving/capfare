"""python -m capfare_backtest.cli run [--flights N] [--out DIR] [--docs ../docs]"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from .calibrate import evaluate, finalize_options, search
from .flex import calibrate_flex
from .data import CsvSource, SyntheticSource
from .report import chart_dist, chart_sensitivity, chart_weekly, write_markdown
from .simulate import BuyerConfig, required_capital, simulate_cap, simulate_drop

GLOBAL = {
    "max_quote_snapshot_age_secs": 3_600,
    "max_index_snapshot_age_secs": 6 * 3_600,
    "max_attestation_age_secs": 3_600,
    "final_check_lead_secs": 86_400,
    "claim_grace_secs": 3 * 86_400,
    # US rule: free cancellation for 24 hours after booking (flights booked 7+ days ahead);
    # payouts wait for a live booking check after it.
    "free_cancel_window_secs": 86_400,
    "sold_out_premium_refund": True,
    "protocol_fee_bps": 500,
    "usdc_micro_per_cent": 10_800,
    "param_timelock_secs": 2 * 86_400,
}


def demo_variant(params: dict) -> dict:
    """Same pricing, short timings so the scripted testnet demo runs in minutes."""
    d = copy.deepcopy(params)
    d["global"]["param_timelock_secs"] = 60
    d["global"]["claim_grace_secs"] = 3_600
    d["global"]["free_cancel_window_secs"] = 30
    d["cap"]["activation_delay_secs"] = 20
    d["drop"]["validity_secs"] = 90
    # Same duration multipliers, demo-length windows (the default 90 s stands in for 7 days).
    d["drop"]["validity_options_secs"] = [60, 90, 180, 300]
    d["drop"]["purchase_window_secs"] = 3_600
    return d


def run(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    docs = Path(args.docs)
    img = docs / "img" / "pricing"
    img.mkdir(parents=True, exist_ok=True)
    if args.csv:
        flights = CsvSource(args.csv).flights()
    else:
        flights = SyntheticSource(seed=args.seed).flights(args.flights)
    cfg = BuyerConfig(buyers_per_flight=args.buyers, informed_share=args.informed)
    print(f"{len(flights)} flights ({'synthetic' if flights[0].synthetic else 'real'})")
    cap_p, cap_best, _ = search("cap", flights, cfg, args.consumer_max)
    drop_p, drop_best, _ = search("drop", flights, cfg, args.consumer_max)
    cap_p = finalize_options("cap", flights, cap_p, cfg)
    drop_p = finalize_options("drop", flights, drop_p, cfg)
    cap_p, flex_report = calibrate_flex(cap_p, cfg, n=args.flex_scenarios)
    params = {"global": GLOBAL, "cap": cap_p, "drop": drop_p}
    cap_s = evaluate("cap", flights, cap_p, cfg, seed=99)
    drop_s = evaluate("drop", flights, drop_p, cfg, seed=98)
    sens = []
    for inf in (0.0, 0.1, 0.25, 0.4, 0.6):
        c = copy.copy(cfg)
        c.informed_share = inf
        for prod, p in (("cap", cap_p), ("drop", drop_p)):
            s = evaluate(prod, flights, p, c, seed=55)
            sens.append({"product": prod, "informed_share": inf, "breakage": c.breakage_uninformed,
                         "loss_ratio": s["loss_ratio"], "return": s["vault_return_on_premium"]})
    for brk in (0.1, 0.5):
        c = copy.copy(cfg)
        c.breakage_uninformed = brk
        for prod, p in (("cap", cap_p), ("drop", drop_p)):
            s = evaluate(prod, flights, p, c, seed=56)
            sens.append({"product": prod, "informed_share": c.informed_share, "breakage": brk,
                         "loss_ratio": s["loss_ratio"], "return": s["vault_return_on_premium"]})
    capital = []
    cap_recs, drop_recs = simulate_cap(flights, cap_p, cfg, seed=77), simulate_drop(flights, drop_p, cfg, seed=78)
    for vol in (10, 50, 200):
        capital.append({"product": "cap", **required_capital(cap_recs, policies_per_week=vol)})
        capital.append({"product": "drop", **required_capital(drop_recs, policies_per_week=vol)})
    res = {"seed": args.seed, "flights": len(flights), "buyers_per_flight": args.buyers, "informed_share": args.informed,
           "synthetic": flights[0].synthetic, "cap": cap_s, "drop": drop_s, "cap_best": {k: v for k, v in cap_best.items() if k != "params"},
           "drop_best": {k: v for k, v in drop_best.items() if k != "params"}, "sensitivity": sens,
           "capital": capital, "flex": flex_report,
           "options": {k: {"deductibles_eur": [d / 100 for d in p["deductible_options"]], "deductible_mult": [m / 10_000 for m in p["deductible_mult_bps"]],
                           "durations_days": [v / 86_400 for v in p["validity_options_secs"]], "duration_mult": [m / 10_000 for m in p["validity_mult_bps"]]}
                       for k, p in (("cap", cap_p), ("drop", drop_p))}}
    chart_weekly(cap_s, "Price Cap vault — weekly P&L (synthetic)", img / "cap_weekly.png")
    chart_weekly(drop_s, "Drop Guarantee vault — weekly P&L (synthetic)", img / "drop_weekly.png")
    chart_dist(cap_s, "Price Cap — P&L per policy (synthetic)", img / "cap_dist.png")
    chart_dist(drop_s, "Drop Guarantee — P&L per policy (synthetic)", img / "drop_dist.png")
    chart_sensitivity([r for r in sens if r["breakage"] == cfg.breakage_uninformed], "informed_share",
                      "Vault return vs share of informed buyers (synthetic)", img / "sensitivity_informed.png")
    chart_sensitivity([r for r in sens if r["informed_share"] == cfg.informed_share], "breakage",
                      "Vault return vs breakage (synthetic)", img / "sensitivity_breakage.png")
    meta = {"source": "synthetic" if res["synthetic"] else "csv", "seed": args.seed, "flights": len(flights),
            "note": "Parameters fitted on synthetic data; see docs/PRICING.md"}
    (out / "premium_params.json").write_text(json.dumps({**params, "_meta": meta}, indent=2))
    (out / "demo_params.json").write_text(json.dumps({**demo_variant(params), "_meta": {**meta, "variant": "demo timings"}}, indent=2))
    slim = {k: v for k, v in res.items()}
    for k in ("cap", "drop"):
        slim[k] = {kk: vv for kk, vv in res[k].items() if kk not in ("weekly_pnl_eur", "pnl_per_policy_dist_eur")}
    (out / "results.json").write_text(json.dumps(slim, indent=2))
    write_markdown(docs / "PRICING.md", res, "img/pricing")
    print(json.dumps({k: slim[k] for k in ("cap", "drop", "cap_best", "drop_best")}, indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--flights", type=int, default=1500)
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--buyers", type=float, default=4.0)
    r.add_argument("--informed", type=float, default=0.25)
    r.add_argument("--consumer-max", type=float, default=10.0)
    r.add_argument("--csv", default=None)
    r.add_argument("--flex-scenarios", type=int, default=120)
    r.add_argument("--out", default="output")
    r.add_argument("--docs", default="../docs")
    a = ap.parse_args()
    if a.cmd == "run":
        run(a)


if __name__ == "__main__":
    main()
