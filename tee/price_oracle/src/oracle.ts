import { flightKeyHash, signSnapshot, validateFlightKey, type FlightKey, type PriceSnapshot, type SignedSnapshot } from "@capfare/shared";
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
    await this.limiter.wait(adapter.id);
    const obs = await adapter.fetch(k);
    const h = flightKeyHash(k);
    const hist = this.history.get(h) ?? [];
    let now = this.now();
    // Snapshots for a flight must be strictly increasing in time on-chain.
    const last = hist[hist.length - 1];
    if (last && now <= last.t) now = last.t + 1;
    const snap: PriceSnapshot = {
      flight_key_hash: h,
      price_minor: obs.price_minor,
      currency: "EUR",
      available: obs.available,
      signals: {
        momentum_bucket: momentumBucket(hist, now, obs.price_minor),
        availability_bucket: availabilityBucket(obs.lower_classes_closed, obs.seats_left),
        season_flag: seasonFlag(obs.departure_ts),
      },
      departure_ts: obs.departure_ts,
      observed_at: now,
      source_id: adapter.id,
      enclave_measurement: this.opts.keys.measurement,
    };
    hist.push({ t: now, price_minor: obs.price_minor, available: obs.available });
    this.history.set(h, hist.slice(-500));
    return signSnapshot(snap, this.opts.keys.signing);
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
