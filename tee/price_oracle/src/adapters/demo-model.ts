/**
 * Demo-only adapter for every flight on the CapFare demo booking site: prices come from the
 * shared deterministic demo fare model (shared/src/demo-fares.ts), so the booking site and
 * the oracle agree. Snapshots are tagged source_id "demo" like the scripted adapter.
 */
import { listFlights, modelFare, type FlightKey, type RouteKey } from "@capfare/shared";
import type { FareObservation, PriceAdapter } from "./types.ts";

/** Demo "market moves" for a whole route and day (all flights, all fare classes). */
export const ROUTE_DEMO_STEPS = [1, 1.12, 1.27, 1.45];

const routeDay = (k: { origin: string; destination: string; departure_date: string }) => `${k.origin}-${k.destination}-${k.departure_date}`;

export class DemoModelAdapter implements PriceAdapter {
  readonly id = "demo";
  readonly access = "demo-only" as const;
  readonly local = true;
  private step = new Map<string, number>();

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
    const step = this.step.get(routeDay(k)) ?? 0;
    const price = Math.round((m.price_minor * ROUTE_DEMO_STEPS[step]) / 100) * 100;
    return { price_minor: price, currency: "EUR", available: true, departure_ts: m.departure_ts, lower_classes_closed: Math.min(4, 1 + step) };
  }

  flightsOn(r: RouteKey): FlightKey[] {
    return listFlights(r.origin, r.destination, r.departure_date).map((f) => ({
      airline: f.airline, flight_number: f.flight_number, departure_date: f.departure_date, origin: f.origin, destination: f.destination, fare_class: r.fare_class,
    })).filter((k) => modelFare(k) !== null);
  }

  /** Demo control: every flight on the route and day gets more expensive. */
  advanceRoute(r: RouteKey, to?: number): { step: number; of: number } {
    const k = routeDay(r);
    const next = Math.max(0, Math.min(to ?? (this.step.get(k) ?? 0) + 1, ROUTE_DEMO_STEPS.length - 1));
    this.step.set(k, next);
    return { step: next, of: ROUTE_DEMO_STEPS.length };
  }
}
