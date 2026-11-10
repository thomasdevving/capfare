import { describe, expect, it } from "vitest";
import { accountAlerts, policyAlerts, watchAlerts, type Policy, type SnapshotRecord, type Watch } from "../src/index.ts";

const T = 1_900_000_000;
const flight = { airline: "KL", flight_number: "KL1695", departure_date: "2030-03-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };

function policy(over: Partial<Policy> = {}): Policy {
  return {
    id: 7, owner: "alice.test", product: "cap", flight_key_hash: "aa", coverage: { flight }, seats: 2,
    strike_minor: 18_000, deductible_minor: 500, max_payout_minor: 15_000, premium_minor: 600,
    purchased_at: T - 2 * 86_400, active_from: T - 86_400 - 60, expires_at: T + 5 * 86_400, departure_ts: T + 30 * 86_400,
    state: "active", booking_nullifier: null, lowest_price_seen_minor: null, index_at_booking_minor: null, paid_price_minor: null,
    refundable: null, payout_minor: null, booked_flight: null, booked_flight_key_hash: null, seats_covered: null, trip_id: null,
    auto_drop_max_premium_minor: null, linked_policy: null, final_check_at: null, usdc_micro_per_cent: 10_800, premium_usdc: "0",
    lock_usdc: "0", route_week_key: "bb", passenger_commitment: "cc", busy: false, note: null, ...over,
  };
}
const snap = (price: number, available = true): SnapshotRecord => ({ price_minor: price, available, signals: { momentum_bucket: 2, availability_bucket: 1, season_flag: false }, departure_ts: T + 30 * 86_400, observed_at: T - 60, demo: true });
const ctx = (now: number, s: SnapshotRecord | null) => ({ now, snapshot: s, claim_grace_secs: 3 * 86_400, sold_out_premium_refund: true });

describe("alerts", () => {
  it("tells the traveller to book when the price is above the cap, with the amount for all seats", () => {
    const a = policyAlerts(policy(), ctx(T, snap(26_000)));
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("cap_in_money");
    expect(a[0].body).toContain("€150"); // (260 - 180 - 5) x 2 = 150
    expect(a[0].body).toContain("2 travellers");
    expect(a[0].href).toBe("/claim/7");
  });

  it("gives a new id only when the possible payout grows by €20", () => {
    const id = (p: number) => policyAlerts(policy(), ctx(T, snap(p)))[0].id;
    expect(id(26_000)).toBe(id(26_400));
    expect(id(26_000)).not.toBe(id(28_500));
  });

  it("says nothing before activation and nothing below the cap after the first day", () => {
    expect(policyAlerts(policy({ active_from: T + 60 }), ctx(T, snap(26_000)))).toEqual([]);
    expect(policyAlerts(policy(), ctx(T, snap(17_000)))).toEqual([]);
    expect(policyAlerts(policy({ active_from: T - 60 }), ctx(T, snap(17_000)))[0].kind).toBe("cap_active");
  });

  it("warns before a cap ends and after it ended, until the claim deadline", () => {
    expect(policyAlerts(policy({ expires_at: T + 3600 }), ctx(T, snap(17_000))).map((x) => x.kind)).toEqual(["cap_expiring"]);
    expect(policyAlerts(policy({ expires_at: T - 3600 }), ctx(T, snap(17_000))).map((x) => x.kind)).toEqual(["claim_window"]);
    expect(policyAlerts(policy({ expires_at: T - 4 * 86_400 }), ctx(T, snap(17_000)))).toEqual([]);
  });

  it("offers the sold-out refund", () => {
    expect(policyAlerts(policy(), ctx(T, snap(17_000, false))).map((x) => x.kind)).toContain("sold_out");
  });

  it("walks a held refundable claim through its final check", () => {
    const held = policy({ state: "claimed", final_check_at: T + 10 * 86_400, payout_minor: 13_000 });
    const kinds = (now: number) => policyAlerts(held, ctx(now, null)).map((x) => [x.kind, x.urgency]);
    expect(kinds(T)).toEqual([["payout_held", "info"]]);
    expect(kinds(T + 9.5 * 86_400)).toEqual([["final_check_soon", "info"]]);
    expect(kinds(T + 10 * 86_400)).toEqual([["final_check_due", "urgent"]]);
    expect(kinds(T + 34 * 86_400)).toEqual([["final_check_missed", "info"]]);
  });

  it("drop guarantee: covered amount while the price falls, then settle", () => {
    const d = policy({ product: "drop", strike_minor: 22_000, deductible_minor: 300, max_payout_minor: 8_000, seats_covered: 2, active_from: T - 3600, expires_at: T + 86_400 });
    const falling = policyAlerts(d, ctx(T, snap(19_500)));
    expect(falling[0].kind).toBe("drop_falling");
    expect(falling[0].body).toContain("€44"); // (220 - 195 - 3) x 2
    expect(policyAlerts(d, ctx(T + 86_400 + 10, snap(19_500)))[0].kind).toBe("drop_settle");
  });

  it("route coverage is described as any flight", () => {
    const r = policy({ coverage: { route: { origin: "AMS", destination: "BCN", departure_date: "2030-03-14", fare_class: "economy_light" } } });
    const a = policyAlerts(r, ctx(T, snap(26_000)));
    expect(a[0].title).toContain("Any flight AMS→BCN");
    expect(a[0].body).toContain("fare on the route");
  });

  it("sorts urgent alerts first across policies", () => {
    const list = accountAlerts(
      [policy({ id: 1, state: "paid_out", payout_minor: 7_000 }), policy({ id: 2, state: "claimed", final_check_at: T - 10, payout_minor: 5_000 })],
      {},
      T,
      { claim_grace_secs: 3 * 86_400, sold_out_premium_refund: true },
    );
    expect(list.map((x) => x.kind)).toEqual(["final_check_due", "paid_out"]);
  });
});

describe("watched prices", () => {
  const w: Watch = {
    id: "ab",
    coverage: { flight: { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" } },
    seats: 2,
    baseline_minor: 17_000,
    created_at: 0,
  };
  const at = (price: number, available = true) => watchAlerts(w, { price_minor: price, available });
  it("stays quiet for small moves, then alerts once per 10% band", () => {
    expect(at(18_000)).toEqual([]);
    const up = at(19_000);
    expect(up.map((a) => [a.id, a.kind, a.title])).toEqual([["w:ab:watch_rise:1", "watch_rise", "KL1695 AMS→BCN, 2027-06-14: up €20 to €190"]]);
    expect(up[0].href).toBe("/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&fare=economy_light&product=cap&pax=2");
    expect(at(19_500)[0].id).toBe("w:ab:watch_rise:1");
    expect(at(21_000)[0].id).toBe("w:ab:watch_rise:2");
    expect(at(15_000)[0].id).toBe("w:ab:watch_drop:1");
  });
  it("target price and sold out", () => {
    expect(watchAlerts({ ...w, target_minor: 16_000 }, { price_minor: 15_500, available: true }).map((a) => a.kind)).toEqual(["watch_target"]);
    expect(at(17_000, false).map((a) => a.kind)).toEqual(["watch_sold_out"]);
    expect(watchAlerts(w, null)).toEqual([]);
  });
  it("route watches link to route cover", () => {
    const r = watchAlerts({ ...w, coverage: { route: { origin: "AMS", destination: "BCN", departure_date: "2027-06-14", fare_class: "economy_light" } } }, { price_minor: 20_000, available: true });
    expect(r[0].href).toContain("scope=route");
  });
});
