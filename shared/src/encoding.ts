import { sha256 } from "@noble/hashes/sha2.js";
import { BorshWriter, bytesToHex, hexToBytes } from "./borsh.ts";
import type { BookingAttestation, Coverage, FlightKey, PriceSnapshot, RouteKey } from "./types.ts";
import { FARE_CLASSES } from "./types.ts";

const enc = new TextEncoder();
export const FLIGHT_KEY_DOMAIN = "capfare/flight-key/v1";
export const SNAPSHOT_DOMAIN = "capfare/price-snapshot/v1";
export const ATTESTATION_DOMAIN = "capfare/booking-attestation/v1";
export const ROUTE_WEEK_DOMAIN = "capfare/route-week/v1";
export const ROUTE_KEY_DOMAIN = "capfare/route-key/v1";
export const LEG_NULLIFIER_DOMAIN = "capfare/leg-nullifier/v1";

function digest(domain: string, body: Uint8Array): Uint8Array {
  const d = enc.encode(domain);
  const buf = new Uint8Array(d.length + body.length);
  buf.set(d, 0);
  buf.set(body, d.length);
  return sha256(buf);
}

export function encodeFlightKey(k: FlightKey): Uint8Array {
  return new BorshWriter()
    .string(k.airline)
    .string(k.flight_number)
    .string(k.departure_date)
    .string(k.origin)
    .string(k.destination)
    .string(k.fare_class)
    .bytes();
}

export function flightKeyHash(k: FlightKey): string {
  return bytesToHex(digest(FLIGHT_KEY_DOMAIN, encodeFlightKey(k)));
}

export function encodeRouteKey(r: RouteKey): Uint8Array {
  return new BorshWriter().string(r.origin).string(r.destination).string(r.departure_date).u8(r.date_window_days ?? 0).string(r.fare_class).bytes();
}

export function routeKeyHash(r: RouteKey): string {
  return bytesToHex(digest(ROUTE_KEY_DOMAIN, encodeRouteKey(r)));
}

/** Airport groups for flexible route cover (mirrors capfare_core::AIRPORT_GROUPS). */
export const AIRPORT_GROUPS: Record<string, { label: string; airports: string[] }> = {
  "@LON": { label: "London airports", airports: ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"] },
  "@PAR": { label: "Paris airports", airports: ["CDG", "ORY", "BVA"] },
  "@NL": { label: "Amsterdam, Rotterdam and Eindhoven", airports: ["AMS", "RTM", "EIN"] },
  "@MIL": { label: "Milan airports", airports: ["MXP", "LIN", "BGY"] },
  "@ROM": { label: "Rome airports", airports: ["FCO", "CIA"] },
  "@NYC": { label: "New York airports", airports: ["JFK", "EWR", "LGA"] },
};
export const MAX_DATE_WINDOW_DAYS = 3;

export const airportsOf = (code: string): string[] => AIRPORT_GROUPS[code]?.airports ?? [code];
/** The group an airport belongs to, if any (for "include nearby airports"). */
export const groupOf = (airport: string): string | undefined => Object.keys(AIRPORT_GROUPS).find((g) => AIRPORT_GROUPS[g].airports.includes(airport));

/** Days since 1970-01-01 for "YYYY-MM-DD" (UTC calendar). */
export function daysFromDate(d: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
}

export function coverageHash(c: Coverage): string {
  return "flight" in c ? flightKeyHash(c.flight) : routeKeyHash(c.route);
}

/** H(booking nullifier || flight key hash): each flight of a booking is used once per product. */
export function legNullifier(bookingNullifier: string, flightKeyHashHex: string): string {
  const body = new Uint8Array(64);
  body.set(hexToBytes(bookingNullifier), 0);
  body.set(hexToBytes(flightKeyHashHex), 32);
  return bytesToHex(digest(LEG_NULLIFIER_DOMAIN, body));
}

/** Same rules as RouteKey::validate in Rust. */
export function validateRouteKey(r: RouteKey): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.departure_date) || daysFromDate(r.departure_date) === null) return "departure_date must be YYYY-MM-DD";
  for (const a of [r.origin, r.destination]) {
    if (!/^[A-Z]{3}$/.test(a) && !AIRPORT_GROUPS[a]) return "airports must be 3-letter uppercase IATA codes or airport groups such as @LON";
  }
  const d = airportsOf(r.destination);
  if (airportsOf(r.origin).some((a) => d.includes(a))) return "origin and destination must differ";
  const w = r.date_window_days ?? 0;
  if (!Number.isInteger(w) || w < 0 || w > MAX_DATE_WINDOW_DAYS) return "date window must be 0 to 3 days";
  if (!(FARE_CLASSES as readonly string[]).includes(r.fare_class)) return "unknown fare_class";
  return null;
}

export function validateCoverage(c: Coverage): string | null {
  return "flight" in c ? validateFlightKey(c.flight) : validateRouteKey(c.route);
}

/** True if a booking for flight `k` can be used with coverage `c` (RouteKey::matches in Rust). */
export function coverageCovers(c: Coverage, k: FlightKey): boolean {
  if ("flight" in c) return flightKeyHash(c.flight) === flightKeyHash(k);
  const r = c.route;
  const a = daysFromDate(k.departure_date);
  const b = daysFromDate(r.departure_date);
  const inWindow = a !== null && b !== null && Math.abs(a - b) <= (r.date_window_days ?? 0);
  return airportsOf(r.origin).includes(k.origin) && airportsOf(r.destination).includes(k.destination) && inWindow && k.fare_class === r.fare_class;
}

/** Route, day and fare class of any coverage. */
export function coverageRoute(c: Coverage): RouteKey {
  if ("route" in c) return c.route;
  const f = c.flight;
  return { origin: f.origin, destination: f.destination, departure_date: f.departure_date, date_window_days: 0, fare_class: f.fare_class };
}

/** "KL1695 AMS→BCN, 2027-06-14" or "Any flight AMS→BCN, 2027-06-14". */
export function coverageLabel(c: Coverage): string {
  const r = coverageRoute(c);
  const place = (code: string) => (AIRPORT_GROUPS[code] ? airportsOf(code).join("/") : code);
  const w = r.date_window_days ?? 0;
  return `${"flight" in c ? c.flight.flight_number : "Any flight"} ${place(r.origin)}→${place(r.destination)}, ${r.departure_date}${w ? ` ±${w} day${w > 1 ? "s" : ""}` : ""}`;
}

/** Same rules as FlightKey::validate in Rust. Returns an error message or null. */
export function validateFlightKey(k: FlightKey): string | null {
  if (!/^[A-Z0-9]{2}$/.test(k.airline)) return "airline must be a 2-character uppercase IATA code";
  if (!k.flight_number.startsWith(k.airline) || !/^[A-Z0-9]{2}[0-9]{1,5}$/.test(k.flight_number))
    return "flight_number must be the airline code followed by 1-5 digits";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k.departure_date)) return "departure_date must be YYYY-MM-DD";
  if (!/^[A-Z]{3}$/.test(k.origin) || !/^[A-Z]{3}$/.test(k.destination)) return "airports must be 3-letter uppercase IATA codes";
  if (k.origin === k.destination) return "origin and destination must differ";
  if (!(FARE_CLASSES as readonly string[]).includes(k.fare_class)) return "unknown fare_class";
  return null;
}

/** Normalises user input like "kl 1695" into a FlightKey (no validation of existence). */
export function normalizeFlightKey(input: Partial<FlightKey> & { flight_number: string }): FlightKey {
  const fn = input.flight_number.replace(/\s+/g, "").toUpperCase();
  return {
    airline: (input.airline ?? fn.slice(0, 2)).toUpperCase(),
    flight_number: fn,
    departure_date: input.departure_date ?? "",
    origin: (input.origin ?? "").toUpperCase(),
    destination: (input.destination ?? "").toUpperCase(),
    fare_class: input.fare_class ?? "economy_light",
  };
}

const STATUS = ["active", "cancelled", "unknown"] as const;
const REFUND = ["non_refundable", "refundable", "unknown"] as const;
const METHOD = ["dkim_eml", "status_check", "tls_page"] as const;

export function encodeSnapshot(s: PriceSnapshot): Uint8Array {
  return new BorshWriter()
    .fixed(hexToBytes(s.flight_key_hash), 32)
    .u64(s.price_minor)
    .string(s.currency)
    .bool(s.available)
    .u8(s.signals.momentum_bucket)
    .u8(s.signals.availability_bucket)
    .bool(s.signals.season_flag)
    .u64(s.departure_ts)
    .u64(s.observed_at)
    .string(s.source_id)
    .fixed(hexToBytes(s.enclave_measurement), 32)
    .bytes();
}

export function snapshotDigest(s: PriceSnapshot): Uint8Array {
  return digest(SNAPSHOT_DOMAIN, encodeSnapshot(s));
}

function idx<T extends readonly string[]>(arr: T, v: string): number {
  const i = arr.indexOf(v);
  if (i < 0) throw new Error(`invalid enum value ${v}`);
  return i;
}

export function encodeAttestation(a: BookingAttestation): Uint8Array {
  return new BorshWriter()
    .fixed(hexToBytes(a.flight_key_hash), 32)
    .u64(a.paid_price_minor)
    .string(a.currency)
    .string(a.fare_class)
    .u8(idx(REFUND, a.refundable))
    .fixed(hexToBytes(a.booking_ref_nullifier), 32)
    .u8(idx(STATUS, a.status))
    .u8(idx(METHOD, a.method))
    .u64(a.booked_at)
    .u64(a.verified_at)
    .fixed(hexToBytes(a.enclave_measurement), 32)
    .fixed(hexToBytes(a.passenger_commitment), 32)
    .u8(a.seats)
    .bytes();
}

export function attestationDigest(a: BookingAttestation): Uint8Array {
  return digest(ATTESTATION_DOMAIN, encodeAttestation(a));
}

export function routeWeekKey(origin: string, destination: string, departureTs: number): string {
  const week = Math.floor(departureTs / (7 * 86_400));
  return bytesToHex(digest(ROUTE_WEEK_DOMAIN, new BorshWriter().string(origin).string(destination).u64(week).bytes()));
}

export { sha256 };
