import PostalMime from "postal-mime";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex, flightKeyHash, signAttestation, validateFlightKey,
  type BookingAttestation, type FlightKey, type SignedBookingAttestation,
} from "@capfare/shared";
import type { KeyMaterial } from "@capfare/tee-common";
import type { AirlineAdapter, ParsedBooking } from "./airlines/types.ts";
import { verifyOriginalEml, type Resolver } from "./dkim.ts";

export class VerifyError extends Error {}

export interface VerifierOptions {
  keys: KeyMaterial;
  airlines: AirlineAdapter[];
  resolver?: Resolver;
  /** Status checker override per airline (e.g. the demo airline). */
  statusCheckers?: Record<string, (ref: string, last: string) => Promise<{ status: "active" | "cancelled" | "unknown"; booking: ParsedBooking }>>;
  now?: () => number;
}

export function nullifier(salt: Uint8Array, airline: string, bookingRef: string): string {
  const enc = new TextEncoder();
  const a = enc.encode(airline.toUpperCase());
  const r = enc.encode(bookingRef.toUpperCase().trim());
  return bytesToHex(sha256(new Uint8Array([...salt, ...a, 0x00, ...r])));
}

function pickSegment(b: ParsedBooking, hint?: FlightKey): FlightKey {
  const toKey = (s: ParsedBooking["segments"][number]): FlightKey => ({
    airline: b.airline,
    flight_number: s.flight_number,
    departure_date: s.departure_date,
    origin: s.origin,
    destination: s.destination,
    fare_class: s.fare_class,
  });
  const keys = b.segments.map(toKey);
  if (hint) {
    const h = flightKeyHash(hint);
    const match = keys.find((k) => flightKeyHash(k) === h);
    if (!match) throw new VerifyError("the booking does not contain the covered flight (number, date, airports and fare class must match)");
    return match;
  }
  if (keys.length !== 1) throw new VerifyError("booking has several flights; choose the covered one");
  return keys[0];
}

export class Verifier {
  private now: () => number;
  constructor(private o: VerifierOptions) {
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private airline(code: string): AirlineAdapter {
    const a = this.o.airlines.find((x) => x.code === code);
    if (!a) throw new VerifyError(`airline ${code} is not supported yet`);
    return a;
  }

  private attest(b: ParsedBooking, fk: FlightKey, status: BookingAttestation["status"], method: BookingAttestation["method"], bookedAt: number): SignedBookingAttestation {
    const err = validateFlightKey(fk);
    if (err) throw new VerifyError(err);
    if (b.currency !== "EUR") throw new VerifyError("only EUR bookings are supported");
    const att: BookingAttestation = {
      flight_key_hash: flightKeyHash(fk),
      paid_price_minor: b.paid_price_minor,
      currency: "EUR",
      fare_class: fk.fare_class,
      refundable: b.refundable,
      booking_ref_nullifier: nullifier(this.o.keys.salt, b.airline, b.booking_ref),
      status,
      method,
      booked_at: bookedAt,
      verified_at: this.now(),
      enclave_measurement: this.o.keys.measurement,
    };
    return signAttestation(att, this.o.keys.signing);
  }

  /** DKIM path: original .eml -> attestation. Returns the public flight key too. */
  async verifyEml(raw: string, hint?: FlightKey): Promise<{ attestation: SignedBookingAttestation; flight_key: FlightKey }> {
    const domains = this.o.airlines.flatMap((a) => a.dkimDomains);
    const v = await verifyOriginalEml(raw, domains, { resolver: this.o.resolver });
    if (!v.ok) throw new VerifyError(v.reason);
    const adapter = this.o.airlines.find((a) => a.dkimDomains.some((d) => v.domain === d || v.domain.endsWith("." + d)));
    if (!adapter) throw new VerifyError("no parser for this airline");
    const mail = await PostalMime.parse(raw);
    const booking = adapter.parseEml(mail.text ?? "", mail.html ?? undefined);
    if (!booking) throw new VerifyError("could not read the booking details from this email");
    const fk = pickSegment(booking, hint);
    const bookedAt = Math.floor(v.date.getTime() / 1000);
    return { attestation: this.attest(booking, fk, "active", "dkim_eml", bookedAt), flight_key: fk };
  }

  /** Status path: booking reference + last name -> manage-booking page -> attestation. */
  async verifyStatus(airline: string, ref: string, lastName: string, hint?: FlightKey, bookedAt?: number): Promise<{ attestation: SignedBookingAttestation; flight_key: FlightKey }> {
    const checker = this.o.statusCheckers?.[airline];
    const adapter = this.airline(airline);
    const check = checker ?? (adapter.statusAccess !== "none" ? adapter.checkStatus?.bind(adapter) : undefined);
    if (!check) throw new VerifyError(`status checks for ${adapter.name} are not available; upload the original confirmation email instead`);
    const r = await check(ref, lastName);
    const fk = pickSegment(r.booking, hint);
    return { attestation: this.attest(r.booking, fk, r.status, "status_check", bookedAt ?? this.now()), flight_key: fk };
  }
}
