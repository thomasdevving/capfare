import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { flightKeyHash, routeKeyHash, verifySnapshot } from "@capfare/shared";
import { devKeys } from "@capfare/tee-common";
import { AirlineSiteAdapter, AIRLINE_SITES, DemoModelAdapter, availabilityBucket, dueFlights, momentumBucket, Oracle, parseFarePage, ScriptedPriceAdapter } from "../src/index.ts";

const paths = JSON.parse(readFileSync(new URL("../demo/price_paths.json", import.meta.url), "utf8")).paths;
const cap = paths[0].flight_key;

beforeAll(() => {
  process.env.CAPFARE_DEPLOYMENT = "test";
});

describe("scripted adapter + oracle", () => {
  it("produces signed demo snapshots that follow the script", async () => {
    const scripted = new ScriptedPriceAdapter(paths);
    let t = 1_800_000_000;
    const oracle = new Oracle({ keys: devKeys("price_oracle"), adapters: [scripted], now: () => t, fetchRatePerSec: 1000 });
    const s1 = await oracle.snapshot(cap);
    expect(verifySnapshot(s1)).toBe(true);
    expect(s1.snapshot.source_id).toBe("demo");
    expect(s1.snapshot.price_minor).toBe(17000);
    expect(s1.snapshot.flight_key_hash).toBe(flightKeyHash(cap));
    scripted.advance(cap, 3);
    t += 3 * 86400;
    const s2 = await oracle.snapshot(cap);
    expect(s2.snapshot.price_minor).toBe(26000);
    expect(s2.snapshot.signals.momentum_bucket).toBe(4);
    expect(s2.snapshot.signals.season_flag).toBe(true);
    // Same timestamp again is bumped to stay strictly increasing.
    const s3 = await oracle.snapshot(cap);
    expect(s3.snapshot.observed_at).toBeGreaterThan(s2.snapshot.observed_at);
  });

  it("cannot be enabled outside demo deployments", () => {
    process.env.CAPFARE_DEPLOYMENT = "production";
    expect(() => new ScriptedPriceAdapter(paths)).toThrow(/only allowed/);
    process.env.CAPFARE_DEPLOYMENT = "dev";
    expect(() => new ScriptedPriceAdapter(paths)).toThrow(/only allowed/);
    process.env.CAPFARE_DEPLOYMENT = "test";
  });

  it("refuses demo-only adapters in non-demo oracles", () => {
    const klm = new AirlineSiteAdapter(AIRLINE_SITES[0]);
    expect(klm.access).toBe("demo-only");
    process.env.CAPFARE_DEPLOYMENT = "dev";
    expect(() => new Oracle({ keys: devKeys("price_oracle"), adapters: [klm] })).toThrow(/demo-only/);
    process.env.CAPFARE_DEPLOYMENT = "test";
  });
});

describe("signals", () => {
  it("momentum buckets", () => {
    const now = 1_000_000;
    const hist = [{ t: now - 48 * 3600, price_minor: 20000, available: true }];
    expect(momentumBucket(hist, now, 20000)).toBe(2);
    expect(momentumBucket(hist, now, 23000)).toBe(4);
    expect(momentumBucket(hist, now, 17000)).toBe(0);
    expect(momentumBucket([], now, 17000)).toBe(2);
  });
  it("availability buckets", () => {
    expect(availabilityBucket(0)).toBe(0);
    expect(availabilityBucket(1, 4)).toBe(3);
    expect(availabilityBucket(9)).toBe(4);
  });
  it("schedules flights near departure more often", () => {
    const now = 2_000_000;
    const mk = (h: string, dep: number) => ({ flight_key_hash: h, departure_ts: dep, state: "active", coverage: { flight: cap } }) as any;
    const last = new Map([["a", now - 1000], ["b", now - 1000]]);
    const due = dueFlights([mk("a", now + 10 * 86400), mk("b", now + 3600)], last, now);
    expect(due.map((p: any) => p.flight_key_hash)).toEqual(["b"]);
  });
});

describe("airline page parser (fixture HTML)", () => {
  const html = readFileSync(new URL("./fixtures/offer_page.html", import.meta.url), "utf8");
  it("reads the fare card price", () => {
    expect(parseFarePage(html, "economy_light")).toEqual({ price_minor: 17000, available: true });
    expect(parseFarePage(html, "economy_flex")).toEqual({ price_minor: 0, available: false });
    expect(parseFarePage(html, "business")).toBeNull();
  });
});

describe("demo model adapter", () => {
  it("prices any flight in the demo schedule, scripted paths take precedence", async () => {
    const scripted = new ScriptedPriceAdapter(paths);
    const model = new DemoModelAdapter();
    const oracle = new Oracle({ keys: devKeys("price_oracle"), adapters: [scripted, model], now: () => 1_800_000_000, fetchRatePerSec: 1000 });
    const { listFlights } = await import("@capfare/shared");
    const f = listFlights("AMS", "LIS", "2027-05-02")[0];
    const k = { airline: f.airline, flight_number: f.flight_number, departure_date: f.departure_date, origin: "AMS", destination: "LIS", fare_class: "economy_standard" };
    const s = await oracle.snapshot(k);
    expect(s.snapshot.price_minor).toBe(f.fares[1].price_minor);
    expect(s.snapshot.departure_ts).toBe(f.departure_ts);
    expect(oracle.adapterFor(cap).id).toBe("demo");
    expect(oracle.adapterFor(cap)).toBe(scripted);
    expect(model.supports({ ...k, flight_number: "KL9999" })).toBe(false);
  });
});

describe("route index (route coverage)", () => {
  const route = { origin: "AMS", destination: "BCN", departure_date: cap.departure_date, fare_class: cap.fare_class };

  it("publishes the cheapest available fare on the route, plus a snapshot per flight", async () => {
    const scripted = new ScriptedPriceAdapter(paths);
    const model = new DemoModelAdapter();
    const t = 1_800_000_000;
    const oracle = new Oracle({ keys: devKeys("price_oracle"), adapters: [scripted, model], now: () => t, fetchRatePerSec: 0.001 });
    const r = await oracle.routeSnapshot(route);
    expect(verifySnapshot(r.route)).toBe(true);
    expect(r.route.snapshot.flight_key_hash).toBe(routeKeyHash(route));
    expect(r.flights.length).toBeGreaterThanOrEqual(4);
    expect(r.flights.length).toBe(r.detail.length);
    expect(r.route.snapshot.price_minor).toBe(Math.min(...r.detail.map((d) => d.price_minor)));
    expect(r.route.snapshot.departure_ts).toBe(Math.min(...r.flights.map((f) => f.snapshot.departure_ts)));
    // The scripted anchor flight is part of the route.
    expect(r.detail.some((d) => d.flight_key.flight_number === "KL1695" && d.price_minor === 17_000)).toBe(true);
    // Local demo sources skip the outbound politeness limit (the test would time out otherwise).
  });

  it("route demo moves raise every flight, so the index rises", async () => {
    const scripted = new ScriptedPriceAdapter(paths);
    const model = new DemoModelAdapter();
    let t = 1_800_000_000;
    const oracle = new Oracle({ keys: devKeys("price_oracle"), adapters: [scripted, model], now: () => t, fetchRatePerSec: 1000 });
    const before = (await oracle.routeSnapshot(route)).route.snapshot.price_minor;
    for (const k of scripted.flightsOn(route)) scripted.advance(k, 3);
    model.advanceRoute(route, 3);
    t += 86_400;
    const after = (await oracle.routeSnapshot(route)).route.snapshot;
    expect(after.price_minor).toBeGreaterThan(before);
    expect(after.observed_at).toBeGreaterThan(t - 1);
  });

  it("refuses routes it has no flights for", async () => {
    const oracle = new Oracle({ keys: devKeys("price_oracle"), adapters: [new DemoModelAdapter()] });
    await expect(oracle.routeSnapshot({ ...route, origin: "XXX" })).rejects.toThrow(/no price source/);
  });
});
