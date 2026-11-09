/**
 * DEMO DATA. Deterministic flight schedule and fares used by the CapFare demo booking site
 * and by the demo price source of the oracle, so both always show the same price.
 * Schedules, flight numbers and prices are invented for the demo; they are not real airline data.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { FlightKey } from "./types.ts";

export interface Airport {
  code: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export const AIRPORTS: Airport[] = [
  { code: "AMS", city: "Amsterdam", country: "Netherlands", lat: 52.31, lon: 4.76 },
  { code: "RTM", city: "Rotterdam", country: "Netherlands", lat: 51.96, lon: 4.44 },
  { code: "EIN", city: "Eindhoven", country: "Netherlands", lat: 51.45, lon: 5.37 },
  { code: "BCN", city: "Barcelona", country: "Spain", lat: 41.3, lon: 2.08 },
  { code: "MAD", city: "Madrid", country: "Spain", lat: 40.49, lon: -3.57 },
  { code: "AGP", city: "Málaga", country: "Spain", lat: 36.67, lon: -4.5 },
  { code: "LIS", city: "Lisbon", country: "Portugal", lat: 38.77, lon: -9.13 },
  { code: "CDG", city: "Paris", country: "France", lat: 49.01, lon: 2.55 },
  { code: "LHR", city: "London", country: "United Kingdom", lat: 51.47, lon: -0.45 },
  { code: "FCO", city: "Rome", country: "Italy", lat: 41.8, lon: 12.25 },
  { code: "ATH", city: "Athens", country: "Greece", lat: 37.94, lon: 23.94 },
  { code: "CPH", city: "Copenhagen", country: "Denmark", lat: 55.62, lon: 12.65 },
];

export const AIRLINES: Record<string, string> = {
  KL: "KLM",
  HV: "Transavia",
  VY: "Vueling",
  AF: "Air France",
  IB: "Iberia",
  TP: "TAP Air Portugal",
};

export const FARES = [
  { id: "economy_light", name: "Economy Light", factor: 1.0, bag: "Hand baggage only", refundable: false, changeable: false },
  { id: "economy_standard", name: "Economy Standard", factor: 1.3, bag: "1 checked bag (23 kg)", refundable: false, changeable: true },
  { id: "economy_flex", name: "Economy Flex", factor: 1.85, bag: "1 checked bag, free changes", refundable: true, changeable: true },
] as const;
export type FareId = (typeof FARES)[number]["id"];

export interface DemoFlight {
  airline: string;
  airlineName: string;
  flight_number: string;
  origin: string;
  destination: string;
  departure_date: string;
  dep: string; // HH:MM local
  arr: string;
  durationMin: number;
  departure_ts: number; // UTC seconds
  fares: { id: FareId; name: string; price_minor: number; bag: string; refundable: boolean; changeable: boolean }[];
}

function rng(seed: string) {
  let h = sha256(new TextEncoder().encode(seed));
  let i = 0;
  return () => {
    if (i >= 28) {
      h = sha256(h);
      i = 0;
    }
    const v = ((h[i] << 24) | (h[i + 1] << 16) | (h[i + 2] << 8) | h[i + 3]) >>> 0;
    i += 4;
    return v / 2 ** 32;
  };
}

function km(a: Airport, b: Airport): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

const pad = (n: number) => String(n).padStart(2, "0");

function utcOffsetHours(date: string): number {
  const m = Number(date.slice(5, 7));
  return m >= 4 && m <= 10 ? 2 : 1; // demo approximation of CET/CEST (UK flights use the same for simplicity)
}

/** The demo's anchor flight, matching tee/price_oracle/demo/price_paths.json. */
const ANCHOR = { flight_number: "KL1695", origin: "AMS", destination: "BCN", dep: "07:20", durationMin: 140 };

export function listFlights(origin: string, destination: string, date: string): DemoFlight[] {
  const a = AIRPORTS.find((x) => x.code === origin);
  const b = AIRPORTS.find((x) => x.code === destination);
  if (!a || !b || a === b || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const dist = km(a, b);
  const rand = rng(`capfare-demo:${origin}:${destination}:${date}`);
  const carriers = Object.keys(AIRLINES);
  const n = 4 + Math.floor(rand() * 4);
  const out: DemoFlight[] = [];
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const airline = carriers[Math.floor(rand() * carriers.length)];
    let num = `${airline}${1000 + Math.floor(rand() * 8999)}`;
    while (used.has(num)) num = `${airline}${1000 + Math.floor(rand() * 8999)}`;
    used.add(num);
    const depMin = 6 * 60 + Math.floor(rand() * 15 * 12) * 5;
    const durationMin = Math.round((dist / 780) * 60 + 35 + rand() * 15);
    out.push(build(airline, num, origin, destination, date, depMin, durationMin, dist, rand()));
  }
  if (origin === ANCHOR.origin && destination === ANCHOR.destination) {
    const [h, m] = ANCHOR.dep.split(":").map(Number);
    out.unshift(build("KL", ANCHOR.flight_number, origin, destination, date, h * 60 + m, ANCHOR.durationMin, dist, 0.35));
  }
  return out.sort((x, y) => x.dep.localeCompare(y.dep));
}

/** Anchor fares equal step 0 of the scripted path (€170 / €220 / €315). */
const ANCHOR_FARES: Record<string, number> = { economy_light: 17000, economy_standard: 22000, economy_flex: 31500 };

function build(airline: string, flight_number: string, origin: string, destination: string, date: string, depMin: number, durationMin: number, dist: number, r: number): DemoFlight {
  const anchor = flight_number === ANCHOR.flight_number && origin === ANCHOR.origin && destination === ANCHOR.destination;
  const arrMin = depMin + durationMin;
  const base = 39 + dist * 0.085 + r * 60; // euros
  const airlineFactor = { KL: 1.15, AF: 1.2, IB: 1.05, TP: 1.0, HV: 0.82, VY: 0.78 }[airline] ?? 1;
  const [y, mo, d] = date.split("-").map(Number);
  const departure_ts = Math.floor(Date.UTC(y, mo - 1, d, Math.floor(depMin / 60), depMin % 60) / 1000) - utcOffsetHours(date) * 3600;
  return {
    airline,
    airlineName: AIRLINES[airline],
    flight_number,
    origin,
    destination,
    departure_date: date,
    dep: `${pad(Math.floor(depMin / 60) % 24)}:${pad(depMin % 60)}`,
    arr: `${pad(Math.floor(arrMin / 60) % 24)}:${pad(arrMin % 60)}`,
    durationMin,
    departure_ts,
    fares: FARES.map((f) => ({
      id: f.id,
      name: f.name,
      price_minor: anchor ? ANCHOR_FARES[f.id] : Math.round(base * airlineFactor * f.factor) * 100,
      bag: f.bag,
      refundable: f.refundable,
      changeable: f.changeable,
    })),
  };
}

/** Model price for a flight key, or null if the flight is not in the demo schedule. */
export function modelFare(k: FlightKey): { price_minor: number; departure_ts: number; refundable: boolean } | null {
  const f = listFlights(k.origin, k.destination, k.departure_date).find((x) => x.flight_number === k.flight_number);
  const fare = f?.fares.find((x) => x.id === k.fare_class);
  return f && fare ? { price_minor: fare.price_minor, departure_ts: f.departure_ts, refundable: fare.refundable } : null;
}
