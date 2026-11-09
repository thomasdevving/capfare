import { flightKeyHash, routeKeyHash, signSnapshot, validateFlightKey, validateRouteKey, type FlightKey, type PriceSnapshot, type RouteKey, type SignedSnapshot } from "@capfare/shared";
import { RateLimiter, type KeyMaterial } from "@capfare/tee-common";
import type { PriceAdapter } from "./adapters/types.ts";
import { availabilityBucket, momentumBucket, seasonFlag, type Obs } from "./signals.ts";

export interface OracleOptions {
  keys: KeyMaterial;
  adapters: PriceAdapter[];
  now?: () => number;
  /** Outbound fetch limit per adapter (requests per second). */
  fetchRatePerSec?: number;
}

export class Oracle {
  private history = new Map<string, Obs[]>();
  private limiter: RateLimiter;
  private now: () => number;

  constructor(private opts: OracleOptions) {
    this.limiter = new RateLimiter(3, opts.fetchRatePerSec ?? 0.2);
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    const mode = process.env.CAPFARE_DEPLOYMENT;
    for (const a of opts.adapters) {
      if (a.access === "demo-only" && mode !== "demo" && mode !== "test") {
        throw new Error(`adapter ${a.id} is demo-only and cannot run in ${mode ?? "dev"} deployments`);
      }
    }
  }

  adapterFor(k: FlightKey): PriceAdapter {
    const a = this.opts.adapters.find((x) => x.supports(k));
    if (!a) throw new Error(`no price source for ${k.flight_number}`);
    return a;
  }

  async snapshot(k: FlightKey): Promise<SignedSnapshot> {
    const err = validateFlightKey(k);
    if (err) throw new Error(err);
    const adapter = this.adapterFor(k);
    if (!adapter.local) await this.limiter.wait(adapter.id);
    const obs = await adapter.fetch(k);
    return this.sign(flightKeyHash(k), obs.price_minor, obs.available, availabilityBucket(obs.lower_classes_closed, obs.seats_left), obs.departure_ts, adapter.id);
  }

  private sign(h: string, price: number, available: boolean, availability: number, departureTs: number, source: string): SignedSnapshot {
    const hist = this.history.get(h) ?? [];
    let now = this.now();
    // Snapshots for a key must be strictly increasing in time on-chain.
    const last = hist[hist.length - 1];
    if (last && now <= last.t) now = last.t + 1;
    const snap: PriceSnapshot = {
      flight_key_hash: h,
      price_minor: price,
      currency: "EUR",
      available,
      signals: {
        momentum_bucket: momentumBucket(hist, now, price),
        availability_bucket: availability,
        season_flag: seasonFlag(departureTs),
      },
      departure_ts: departureTs,
      observed_at: now,
      source_id: source,
      enclave_measurement: this.opts.keys.measurement,
    };
    hist.push({ t: now, price_minor: price, available });
    this.history.set(h, hist.slice(-500));
    return signSnapshot(snap, this.opts.keys.signing);
  }

  /** Flights the oracle tracks on a route and day (union over sources, by flight number). */
  flightsOn(r: RouteKey): FlightKey[] {
    const seen = new Map<string, FlightKey>();
    for (const a of this.opts.adapters) for (const k of a.flightsOn?.(r) ?? []) seen.set(k.flight_number, k);
    return [...seen.values()];
  }

  /**
   * Route index for route coverage: one snapshot per tracked flight on the route and day, and
   * a route snapshot (keyed by the route key hash) with the cheapest available fare. The route
   * is "available" while any flight has the fare class; its departure is the earliest flight's,
   * so expiry and final checks are never later than any covered flight's.
   */
  async routeSnapshot(r: RouteKey): Promise<{ route: SignedSnapshot; flights: SignedSnapshot[]; detail: { flight_key: FlightKey; price_minor: number; available: boolean }[] }> {
    const err = validateRouteKey(r);
    if (err) throw new Error(err);
    const keys = this.flightsOn(r);
    if (!keys.length) throw new Error(`no price source for flights ${r.origin}→${r.destination} on ${r.departure_date}`);
    const flights: SignedSnapshot[] = [];
    const detail: { flight_key: FlightKey; price_minor: number; available: boolean }[] = [];
    for (const k of keys) {
      try {
        const s = await this.snapshot(k);
        flights.push(s);
        detail.push({ flight_key: k, price_minor: s.snapshot.price_minor, available: s.snapshot.available });
      } catch {
        /* a flight without a price is left out of the index */
      }
    }
    if (!flights.length) throw new Error("no prices for this route right now");
    const open = flights.filter((s) => s.snapshot.available);
    const cheapest = open.length ? Math.min(...open.map((s) => s.snapshot.price_minor)) : Math.min(...flights.map((s) => s.snapshot.price_minor));
    const departure = Math.min(...flights.map((s) => s.snapshot.departure_ts));
    // Seat pressure on the route: the least constrained flight decides.
    const availability = open.length ? Math.min(...open.map((s) => s.snapshot.signals.availability_bucket)) : 4;
    const source = [...new Set(flights.map((s) => s.snapshot.source_id))].join("+");
    const route = this.sign(routeKeyHash(r), cheapest, open.length > 0, availability, departure, source);
    return { route, flights, detail };
  }

  lastObservation(k: FlightKey): Obs | undefined {
    const h = this.history.get(flightKeyHash(k));
    return h?.[h.length - 1];
  }
}

/** Pushes signed snapshots to the attestation registry through the relayer. */
export async function submitViaRelayer(relayerUrl: string, snapshots: SignedSnapshot[], token?: string): Promise<string[]> {
  const res = await fetch(`${relayerUrl.replace(/\/$/, "")}/v1/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ snapshots }),
  });
  const j = (await res.json()) as { results?: string[]; error?: string };
  if (!res.ok) throw new Error(j.error ?? `relayer ${res.status}`);
  return j.results ?? [];
}
