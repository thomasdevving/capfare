import PostalMime from "postal-mime";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex, flightKeyHash, passengerCommitment, signAttestation, validateFlightKey,
  type BookingAttestation, type FlightKey, type SignedBookingAttestation,
} from "@capfare/shared";
import type { KeyMaterial } from "@capfare/tee-common";
import type { AirlineAdapter, ParsedBooking } from "./airlines/types.ts";
import { verifyOriginalEml, type Resolver } from "./dkim.ts";
import { parseSkylineManagePage } from "./airlines/skyline.ts";

export class VerifyError extends Error {}

export interface VerifierOptions {
  keys: KeyMaterial;
  airlines: AirlineAdapter[];
  resolver?: Resolver;
  /** Status checker override per airline (e.g. the demo airline). */
  statusCheckers?: Record<string, (ref: string, last: string) => Promise<{ status: "active" | "cancelled" | "unknown"; booking: ParsedBooking }>>;
  now?: () => number;
  /** Origins whose manage-booking pages the enclave may fetch for live checks (https in production). */
  pageOrigins?: string[];
  fetchImpl?: typeof fetch;
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

  private attest(b: ParsedBooking, fk: FlightKey, status: BookingAttestation["status"], method: BookingAttestation["method"], bookedAt: number, saltHex: string): SignedBookingAttestation {
    const err = validateFlightKey(fk);
    if (err) throw new VerifyError(err);
    if (b.currency !== "EUR") throw new VerifyError("only EUR bookings are supported");
    if (!b.last_name) throw new VerifyError("could not read the passenger's last name");
    if (!/^[0-9a-f]{64}$/.test(saltHex ?? "")) throw new VerifyError("missing passenger salt");
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
      passenger_commitment: passengerCommitment(b.last_name, saltHex),
    };
    return signAttestation(att, this.o.keys.signing);
  }

  /** DKIM path: original .eml -> attestation. Returns the public flight key too. */
  async verifyEml(raw: string, saltHex: string, hint?: FlightKey): Promise<{ attestation: SignedBookingAttestation; flight_key: FlightKey }> {
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
    return { attestation: this.attest(booking, fk, "active", "dkim_eml", bookedAt, saltHex), flight_key: fk };
  }

  /** Status path: booking reference + last name -> manage-booking page -> attestation. */
  async verifyStatus(airline: string, ref: string, lastName: string, saltHex: string, hint?: FlightKey, bookedAt?: number): Promise<{ attestation: SignedBookingAttestation; flight_key: FlightKey }> {
    const checker = this.o.statusCheckers?.[airline];
    const adapter = this.airline(airline);
    const check = checker ?? (adapter.statusAccess !== "none" ? adapter.checkStatus?.bind(adapter) : undefined);
    if (!check) throw new VerifyError(`status checks for ${adapter.name} are not available; upload the original confirmation email instead`);
    const r = await check(ref, lastName);
    const fk = pickSegment(r.booking, hint);
    return { attestation: this.attest(r.booking, fk, r.status, "status_check", bookedAt ?? this.now(), saltHex), flight_key: fk };
  }

  /**
   * Live check started by the user: the enclave fetches the user's own manage-booking page
   * (link from the CapFare extension or pasted by the user) directly from the booking site
   * and reads the booking as it is now. No password is involved; the link is the user's.
   */
  async verifyPage(url: string, saltHex: string, hint?: FlightKey): Promise<{ attestation: SignedBookingAttestation; flight_key: FlightKey }> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new VerifyError("that is not a link");
    }
    const allowed = this.o.pageOrigins ?? [];
    if (!allowed.includes(u.origin)) throw new VerifyError("live checks are not available for this website yet");
    const demo = process.env.CAPFARE_DEPLOYMENT === "demo" || process.env.CAPFARE_DEPLOYMENT === "test";
    if (u.protocol !== "https:" && !demo) throw new VerifyError("the booking page must be served over HTTPS");
    if (!u.pathname.startsWith("/booker/manage")) throw new VerifyError("open your booking's manage page first");
    const f = this.o.fetchImpl ?? fetch;
    const res = await f(u.toString(), { redirect: "error", headers: { accept: "text/html" } }).catch(() => {
      throw new VerifyError("the booking site did not respond");
    });
    if (!res.ok) throw new VerifyError(`the booking site answered ${res.status}`);
    const page = parseSkylineManagePage(await res.text());
    if (!page) throw new VerifyError("could not read the booking from that page");
    const fk = pickSegment(page.booking, hint);
    return { attestation: this.attest(page.booking, fk, page.status, "tls_page", page.booked_at, saltHex), flight_key: fk };
  }
}
