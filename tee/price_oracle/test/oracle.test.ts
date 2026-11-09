import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { flightKeyHash, verifySnapshot } from "@capfare/shared";
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
    const mk = (h: string, dep: number) => ({ flight_key_hash: h, departure_ts: dep, state: "active", flight_key: cap }) as any;
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
