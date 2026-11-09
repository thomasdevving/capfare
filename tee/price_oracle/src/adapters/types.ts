import type { FlightKey, RouteKey } from "@capfare/shared";

export interface FareObservation {
  price_minor: number; // EUR cents for the fare class
  currency: "EUR";
  available: boolean;
  /** Scheduled departure, UTC seconds. */
  departure_ts: number;
  /** Optional seat signal: number of cheaper fare classes already closed (0..4+). */
  lower_classes_closed?: number;
  /** Optional seat signal: remaining seats in the fare class, if the airline shows it. */
  seats_left?: number;
}

export interface PriceAdapter {
  /** Stable id, written into the snapshot's source_id (e.g. "klm.com", "demo"). */
  id: string;
  /** "live": permitted automated access; "demo-only": disabled outside demos. */
  access: "live" | "demo-only";
  supports(k: FlightKey): boolean;
  fetch(k: FlightKey): Promise<FareObservation>;
  /** Non-stop flights this source knows on a route and day (for route coverage). */
  flightsOn?(r: RouteKey): FlightKey[];
  /** True if fetching makes no outbound request (demo data): no politeness rate limit. */
  local?: boolean;
}
