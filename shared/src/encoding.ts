import { sha256 } from "@noble/hashes/sha2.js";
import { BorshWriter, bytesToHex, hexToBytes } from "./borsh.ts";
import type { BookingAttestation, FlightKey, PriceSnapshot } from "./types.ts";
import { FARE_CLASSES } from "./types.ts";

const enc = new TextEncoder();
export const FLIGHT_KEY_DOMAIN = "capfare/flight-key/v1";
export const SNAPSHOT_DOMAIN = "capfare/price-snapshot/v1";
export const ATTESTATION_DOMAIN = "capfare/booking-attestation/v1";
export const ROUTE_WEEK_DOMAIN = "capfare/route-week/v1";

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
