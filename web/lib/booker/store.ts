/**
 * Backend of "Skyline Travel (demo)", CapFare's mock flight booking site. Holds bookings and
 * the emails it "sends" (demo inbox). Persisted to a JSON file so restarts keep demo data.
 * Nothing here is a real booking, payment or email.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dkimSign } from "mailauth";
import { flightKeyHash, listFlights, type DemoFlight, type FareId, type SnapshotRecord } from "@capfare/shared";
import { viewClient } from "../chain";
import { serverConfig } from "../config";

export const BOOKER_DOMAIN = "skyline-travel.example";
export const BOOKER_SELECTOR = "skyline";

export interface Passenger {
  title: "Mr" | "Ms" | "Mx";
  first: string;
  last: string;
}

type LegFlight = Pick<DemoFlight, "airline" | "airlineName" | "flight_number" | "origin" | "destination" | "departure_date" | "dep" | "arr" | "durationMin" | "departure_ts">;
type LegFare = { id: FareId; name: string; bag: string; refundable: boolean; changeable: boolean };

/** Return flight of a return booking (same travellers, same booking code). */
export interface ReturnLeg {
  flight: LegFlight;
  fare: LegFare;
  pricePerPassenger: number; // cents
}

export interface Booking {
  ref: string;
  token: string;
  createdAt: number;
  status: "confirmed" | "cancelled";
  cancelledAt?: number;
  /** Outbound (or only) flight. */
  flight: LegFlight;
  fare: LegFare;
  passengers: Passenger[];
  email: string;
  pricePerPassenger: number; // cents, outbound flight
  ret?: ReturnLeg;
  total: number;
  cardLast4: string;
}

export interface Email {
  id: string;
  to: string;
  subject: string;
  date: number;
  ref: string;
  raw: string;
}

interface State {
  bookings: Booking[];
  emails: Email[];
  dkim: { privatePem: string; record: string };
}

const FILE = process.env.BOOKER_DATA_FILE ?? join(tmpdir(), "capfare-demo-booker.json");
let state: State | null = null;
let loadedMtime = 0;

/** Route handlers and pages can run in separate module instances: re-read when the file changed. */
function load(): State {
  if (existsSync(FILE)) {
    try {
      const m = statSync(FILE).mtimeMs;
      if (state && m === loadedMtime) return state;
      state = JSON.parse(readFileSync(FILE, "utf8")) as State;
      loadedMtime = m;
      return state;
    } catch {
      /* start fresh */
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  state = {
    bookings: [],
    emails: [],
    dkim: {
      privatePem: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      record: `v=DKIM1; k=rsa; p=${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`,
    },
  };
  save();
  return state;
}

function save() {
  if (!state) return;
  writeFileSync(FILE, JSON.stringify(state));
  loadedMtime = statSync(FILE).mtimeMs;
}

export function dkimRecord(): string {
  return load().dkim.record;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newRef(): string {
  const b = randomBytes(6);
  return Array.from(b, (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join("");
}

export function findFlight(fn: string, origin: string, destination: string, date: string): DemoFlight | undefined {
  return listFlights(origin, destination, date).find((f) => f.flight_number === fn);
}

/**
 * Current price per passenger: the on-chain oracle snapshot if CapFare has one (so scripted
 * demo price moves show up here too), otherwise the demo fare model.
 */
export async function currentFare(f: DemoFlight, fareId: FareId): Promise<{ price: number; available: boolean }> {
  const model = f.fares.find((x) => x.id === fareId)!.price_minor;
  const c = serverConfig();
  if (!c.attestation) return { price: model, available: true };
  try {
    const h = flightKeyHash({ airline: f.airline, flight_number: f.flight_number, departure_date: f.departure_date, origin: f.origin, destination: f.destination, fare_class: fareId });
    const s = await viewClient().view<SnapshotRecord | null>(c.attestation, "get_latest_snapshot", { flight_key_hash: h });
    return s ? { price: s.available ? s.price_minor : model, available: s.available } : { price: model, available: true };
  } catch {
    return { price: model, available: true };
  }
}

export async function pricesFor(f: DemoFlight): Promise<Record<FareId, { price: number; available: boolean }>> {
  const out = {} as Record<FareId, { price: number; available: boolean }>;
  for (const fare of f.fares) out[fare.id] = await currentFare(f, fare.id);
  return out;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cityOf = (code: string) => ({ AMS: "Amsterdam", RTM: "Rotterdam", EIN: "Eindhoven", BCN: "Barcelona", MAD: "Madrid", AGP: "Malaga", LIS: "Lisbon", CDG: "Paris", LHR: "London", FCO: "Rome", ATH: "Athens", CPH: "Copenhagen" })[code] ?? code;
const eur = (c: number) => `EUR ${(c / 100).toFixed(2)}`;

export function manageUrl(b: Booking, origin = serverConfig().skylineUrl ?? serverConfig().siteUrl): string {
  return `${origin.replace(/\/$/, "")}/booker/manage?ref=${b.ref}&t=${b.token}`;
}

function legLines(prefix: string, flight: LegFlight, fare: LegFare, price: number): string[] {
  const [y, m, d] = flight.departure_date.split("-").map(Number);
  const cap = (x: string) => (prefix ? x.toLowerCase() : x);
  return [
    `${prefix}${cap("Flight")}: ${flight.flight_number} ${cityOf(flight.origin)} (${flight.origin}) to ${cityOf(flight.destination)} (${flight.destination})`,
    `${prefix}${cap("Date")}: ${d} ${MON[m - 1]} ${y}, departs ${flight.dep}, arrives ${flight.arr}`,
    `${prefix}${cap("Fare")}: ${fare.name}`,
    `${prefix}${cap("Ticket type")}: ${fare.refundable ? "Refundable" : "Non-refundable"}`,
    `${prefix}${cap("Price per passenger")}: ${eur(price)}`,
  ];
}

function emailText(b: Booking, kind: "confirmation" | "cancellation"): string {
  const lead = b.passengers[0];
  const legs = b.ret
    ? ["Trip: Return", ...legLines("Outbound ", b.flight, b.fare, b.pricePerPassenger), ...legLines("Return ", b.ret.flight, b.ret.fare, b.ret.pricePerPassenger)]
    : legLines("", b.flight, b.fare, b.pricePerPassenger);
  const refundable = b.fare.refundable && (!b.ret || b.ret.fare.refundable);
  const lines = [
    "DEMO BOOKING - Skyline Travel is CapFare's mock booking site. This is not a real ticket.",
    "",
    kind === "confirmation" ? (b.ret ? "Your trip is booked" : "Your flight is booked") : "Your booking has been cancelled",
    "",
    `Booking code: ${b.ref}`,
    `Lead passenger: ${lead.last.toUpperCase()}/${lead.first.toUpperCase()} ${lead.title.toUpperCase()}`,
    `Passengers: ${b.passengers.length}`,
    ...legs,
    `Total paid: ${eur(b.total)} (card ending ${b.cardLast4})`,
    "",
    kind === "confirmation" ? `Manage your booking: ${manageUrl(b)}` : `Refund: ${refundable ? eur(b.total) + " will be returned to your card (demo)" : "none for non-refundable flights"}`,
    "",
  ];
  return lines.join("\r\n");
}

async function sendEmail(b: Booking, kind: "confirmation" | "cancellation") {
  const s = load();
  const what = b.ret ? `${b.flight.flight_number} + ${b.ret.flight.flight_number}` : `${b.flight.flight_number} on ${b.flight.departure_date}`;
  const subject = kind === "confirmation" ? `Booking confirmed: ${what} (${b.ref})` : `Booking cancelled (${b.ref})`;
  const date = Math.floor(Date.now() / 1000);
  const msg = [
    `From: Skyline Travel (demo) <bookings@${BOOKER_DOMAIN}>`,
    `To: ${b.email}`,
    `Subject: ${subject}`,
    `Date: ${new Date(date * 1000).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(8).toString("hex")}@${BOOKER_DOMAIN}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    emailText(b, kind),
  ].join("\r\n");
  const signed = await dkimSign(msg, {
    signatureData: [{ signingDomain: BOOKER_DOMAIN, selector: BOOKER_SELECTOR, privateKey: s.dkim.privatePem }],
    headerList: "from:to:subject:date:message-id",
  });
  s.emails.unshift({ id: randomBytes(6).toString("hex"), to: b.email.toLowerCase(), subject, date, ref: b.ref, raw: signed.signatures + msg });
  save();
}

export interface LegInput {
  fn: string;
  origin: string;
  destination: string;
  date: string;
  fare: FareId;
}

async function priceLeg(l: LegInput) {
  const f = findFlight(l.fn, l.origin, l.destination, l.date);
  if (!f) throw new Error("This flight is not available");
  const fare = f.fares.find((x) => x.id === l.fare);
  if (!fare) throw new Error("Unknown fare");
  const { price, available } = await currentFare(f, l.fare);
  if (!available) throw new Error(`The ${fare.name} fare on ${f.flight_number} is sold out`);
  return {
    flight: { airline: f.airline, airlineName: f.airlineName, flight_number: f.flight_number, origin: f.origin, destination: f.destination, departure_date: f.departure_date, dep: f.dep, arr: f.arr, durationMin: f.durationMin, departure_ts: f.departure_ts },
    fare: { id: fare.id, name: fare.name, bag: fare.bag, refundable: fare.refundable, changeable: fare.changeable },
    pricePerPassenger: price,
  };
}

export async function createBooking(input: { fn: string; origin: string; destination: string; date: string; fare: FareId; ret?: LegInput; passengers: Passenger[]; email: string; card: string }): Promise<Booking> {
  if (!input.passengers.length || input.passengers.length > 4) throw new Error("1 to 4 passengers");
  for (const p of input.passengers) if (!p.first.trim() || !p.last.trim()) throw new Error("Enter every passenger's first and last name");
  if (!/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Enter a valid email address");
  const digits = input.card.replace(/\D/g, "");
  if (digits.length < 12) throw new Error("Enter a card number (any test number works)");
  const out = await priceLeg({ fn: input.fn, origin: input.origin, destination: input.destination, date: input.date, fare: input.fare });
  const ret = input.ret ? await priceLeg(input.ret) : undefined;
  if (ret && ret.flight.departure_ts <= out.flight.departure_ts) throw new Error("The return flight must leave after the outbound flight");
  const s = load();
  const n = input.passengers.length;
  const b: Booking = {
    ref: newRef(),
    token: randomBytes(16).toString("hex"),
    createdAt: Math.floor(Date.now() / 1000),
    status: "confirmed",
    flight: out.flight,
    fare: out.fare,
    passengers: input.passengers.map((p) => ({ title: p.title, first: p.first.trim(), last: p.last.trim() })),
    email: input.email.trim(),
    pricePerPassenger: out.pricePerPassenger,
    ...(ret ? { ret } : {}),
    total: (out.pricePerPassenger + (ret?.pricePerPassenger ?? 0)) * n,
    cardLast4: digits.slice(-4),
  };
  s.bookings.push(b);
  save();
  await sendEmail(b, "confirmation");
  return b;
}

export function getBooking(ref: string, token: string): Booking | undefined {
  return load().bookings.find((b) => b.ref === ref.toUpperCase() && b.token === token);
}

export function lookupBooking(ref: string, lastName: string): Booking | undefined {
  const n = lastName.trim().toLowerCase();
  return load().bookings.find((b) => b.ref === ref.trim().toUpperCase() && b.passengers.some((p) => p.last.toLowerCase() === n));
}

export async function cancelBooking(ref: string, token: string): Promise<Booking> {
  const b = getBooking(ref, token);
  if (!b) throw new Error("Booking not found");
  if (b.status === "cancelled") return b;
  b.status = "cancelled";
  b.cancelledAt = Math.floor(Date.now() / 1000);
  save();
  await sendEmail(b, "cancellation");
  return b;
}

export function inbox(email: string): Omit<Email, "raw">[] {
  const e = email.trim().toLowerCase();
  return load().emails.filter((m) => m.to === e).map(({ raw, ...rest }) => (void raw, rest));
}

export function emailById(id: string): Email | undefined {
  return load().emails.find((m) => m.id === id);
}
