/**
 * Demo-only adapter that replays scripted price paths from a JSON file.
 * Can only be constructed when CAPFARE_DEPLOYMENT is "demo" or "test". Every snapshot it
 * produces carries source_id "demo", which the on-chain attestation registry rejects
 * unless the deployment was initialised with allow_demo_sources = true.
 */
import { readFileSync } from "node:fs";
import { flightKeyHash, type FlightKey } from "@capfare/shared";
import type { FareObservation, PriceAdapter } from "./types.ts";

export interface ScriptedPath {
  flight_key: FlightKey;
  departure_ts: number;
  steps: { price_minor: number; available: boolean; lower_classes_closed?: number }[];
  label?: string;
}

export class ScriptedPriceAdapter implements PriceAdapter {
  readonly id = "demo";
  readonly access = "demo-only" as const;
  readonly local = true;
  private paths = new Map<string, ScriptedPath>();
  private cursor = new Map<string, number>();

  constructor(paths: ScriptedPath[]) {
    const mode = process.env.CAPFARE_DEPLOYMENT;
    if (mode !== "demo" && mode !== "test") {
      throw new Error("ScriptedPriceAdapter is only allowed when CAPFARE_DEPLOYMENT=demo or test");
    }
    for (const p of paths) {
      const h = flightKeyHash(p.flight_key);
      this.paths.set(h, p);
      this.cursor.set(h, 0);
    }
  }

  static fromFile(path: string): ScriptedPriceAdapter {
    return new ScriptedPriceAdapter(JSON.parse(readFileSync(path, "utf8")).paths);
  }

  supports(k: FlightKey): boolean {
    return this.paths.has(flightKeyHash(k));
  }

  async fetch(k: FlightKey): Promise<FareObservation> {
    const h = flightKeyHash(k);
    const p = this.paths.get(h);
    if (!p) throw new Error("no scripted path for this flight");
    const s = p.steps[Math.min(this.cursor.get(h) ?? 0, p.steps.length - 1)];
    return { price_minor: s.price_minor, currency: "EUR", available: s.available, departure_ts: p.departure_ts, lower_classes_closed: s.lower_classes_closed };
  }

  /** Moves the scripted path forward (demo control endpoint). */
  advance(k: FlightKey, to?: number): { step: number; of: number } {
    const h = flightKeyHash(k);
    const p = this.paths.get(h);
    if (!p) throw new Error("no scripted path for this flight");
    const next = to ?? (this.cursor.get(h) ?? 0) + 1;
    this.cursor.set(h, Math.max(0, Math.min(next, p.steps.length - 1)));
    return { step: this.cursor.get(h)!, of: p.steps.length };
  }

  /** Scripted flights on a route and day (all advance together in route demos). */
  flightsOn(r: { origin: string; destination: string; departure_date: string; fare_class: string }): FlightKey[] {
    return [...this.paths.values()].map((p) => p.flight_key).filter((k) => k.origin === r.origin && k.destination === r.destination && k.departure_date === r.departure_date && k.fare_class === r.fare_class);
  }

  list(): { flight_key: FlightKey; step: number; steps: number; label?: string }[] {
    return [...this.paths.entries()].map(([h, p]) => ({ flight_key: p.flight_key, step: this.cursor.get(h) ?? 0, steps: p.steps.length, label: p.label }));
  }
}
