import json
from pathlib import Path

from capfare_backtest.formula import PremiumInputs, cap_payout, compute_premium, drop_payout

VEC = json.loads((Path(__file__).parents[2] / "shared" / "test-vectors" / "vectors.json").read_text())


def test_premiums_match_rust_core():
    params = VEC["params"]
    for v in VEC["premiums"]:
        i = v["inputs"]
        inp = PremiumInputs(
            product=i["product"], current_price=i["current_price"], strike=i["strike"],
            momentum_bucket=i["signals"]["momentum_bucket"], availability_bucket=i["signals"]["availability_bucket"],
            season_flag=i["signals"]["season_flag"], now=i["now"], departure_ts=i["departure_ts"],
            vault_total_assets=int(i["vault_total_assets"]), vault_locked=int(i["vault_locked"]),
            vault_reserved=int(i["vault_reserved"]), new_lock=int(i["new_lock"]), flight_exposure=i["flight_exposure"],
            deductible=i.get("deductible"), validity_secs=i.get("validity_secs"),
            route_window_days=i.get("route_window_days"), airport_group=i.get("airport_group", False))
        out = compute_premium(params[i["product"]], inp)
        assert out["premium"] == v["premium"]
        assert out["unclamped"] == v["unclamped"]


def test_payouts_match_rust_core():
    for v in VEC["cap_payouts"]:
        assert cap_payout(v["index"], v["paid"], v["strike"], v["deductible"], v["max_payout"]) == v["payout"]
    assert drop_payout(22_000, 19_500, 500, 6_000) == 2_000
