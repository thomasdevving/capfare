/**
 * Demo-only adapter for every flight on the CapFare demo booking site: prices come from the
 * shared deterministic demo fare model (shared/src/demo-fares.ts), so the booking site and
 * the oracle agree. Snapshots are tagged source_id "demo" like the scripted adapter.
 */
import { modelFare, type FlightKey } from "@capfare/shared";
import type { FareObservation, PriceAdapter } from "./types.ts";

export class DemoModelAdapter implements PriceAdapter {
  readonly id = "demo";
  readonly access = "demo-only" as const;

  constructor() {
    const mode = process.env.CAPFARE_DEPLOYMENT;
    if (mode !== "demo" && mode !== "test") throw new Error("DemoModelAdapter is only allowed when CAPFARE_DEPLOYMENT=demo or test");
  }

  supports(k: FlightKey): boolean {
    return modelFare(k) !== null;
  }

  async fetch(k: FlightKey): Promise<FareObservation> {
    const m = modelFare(k);
    if (!m) throw new Error("flight not in the demo schedule");
    return { price_minor: m.price_minor, currency: "EUR", available: true, departure_ts: m.departure_ts, lower_classes_closed: 1 };
  }
}
