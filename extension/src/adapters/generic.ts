/**
 * Generic adapter: reads a flight from any booking page, airline or travel site, without a
 * site-specific template. In order of trust:
 *   1. structured data (schema.org FlightReservation / Flight, as JSON-LD or microdata), which
 *      airlines and travel sites publish for confirmation pages and email clients;
 *   2. the page address (origin, destination, date and travellers in the query or path);
 *   3. the visible text: flight numbers of known airlines, known airport codes, dates and prices,
 *      grouped per result card by walking up from each flight number to its price.
 * Everything here is a hint. Premiums use oracle snapshots and claims use verified bookings.
 */
import { airportsIn, datesIn, flightNumbersIn, pairsIn, parseDateValue, routeIn, urlHints } from "@capfare/shared/booking-link";
import { parseMoney, type ExtractedFlight, type PageExtraction, type RouteHint, type SiteAdapter } from "./types.ts";

export { airportsIn, datesIn, flightNumbersIn, parseDateValue, urlHints } from "@capfare/shared/booking-link";

export interface GenericOptions {
  /** "Today", for dates shown without a year. */
  now?: Date;
}

/* ------------------------------------------------------------------ text */

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "HEAD", "SELECT", "OPTION", "DATALIST"]);
const clean = (s: string) => s.replace(/[\s  ]+/g, " ").trim();

/** Visible-ish text of an element, with a space at element boundaries so "AMS</b><b>BCN" stay apart. */
function makeText() {
  const cache = new Map<Node, string>();
  const text = (n: Node): string => {
    const hit = cache.get(n);
    if (hit !== undefined) return hit;
    let out = "";
    if (n.nodeType === 3) out = n.nodeValue ?? "";
    else if (n.nodeType === 1 || n.nodeType === 9 || n.nodeType === 11) {
      const el = n as Element;
      if (n.nodeType === 1 && (SKIP.has(el.tagName.toUpperCase()) || el.hasAttribute("hidden"))) out = "";
      else {
        const parts: string[] = [];
        for (const c of Array.from(n.childNodes)) {
          const t = text(c);
          if (t) parts.push(t);
        }
        out = parts.join(" ");
      }
    }
    out = clean(out);
    cache.set(n, out);
    return out;
  };
  return text;
}

/* ------------------------------------------------------------ fare class */

const FARE_WORDS: [RegExp, string][] = [
  [/\bbusiness\b|\bzakelijk\b|\baffaires\b|\bnegocios\b/i, "business"],
  [/\bpremium\s?economy\b|\beconomy\s?premium\b|\bpremium comfort\b/i, "premium_economy"],
  [/\bflex(?:ible|i)?\b|\bfully refundable\b|\bflexibel\b/i, "economy_flex"],
  [/\bstandard\b|\bclassic\b|\bmain cabin\b|\bregular\b|\bsmart\b|\bcomfort\b/i, "economy_standard"],
  [/\blight\b|\blite\b|\bbasic\b|\bsaver\b|\bvalue\b|\bbasis\b/i, "economy_light"],
];
/** The fare the text names; several fares (a fare picker) or none: the cheapest, Light. */
export function fareClassIn(text: string): string {
  const hits = FARE_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id);
  return hits.length === 1 ? hits[0] : "economy_light";
}

/* ------------------------------------------------------- structured data */

type Json = Record<string, unknown>;
const typeOf = (o: Json): string[] => {
  const t = o["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^.*[/#]/, ""));
};
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : Array.isArray(v) && v[0] && typeof v[0] === "object" ? (v[0] as Json) : undefined);
const iata = (v: unknown): string | undefined => {
  const o = obj(v);
  const c = (str(o?.iataCode) ?? str(v) ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : undefined;
};

/** Microdata items (itemscope/itemtype) as JSON-LD-like objects. */
function microdata(doc: Document): Json[] {
  const read = (scope: Element): Json => {
    const o: Json = { "@type": scope.getAttribute("itemtype") ?? "" };
    const props = Array.from(scope.querySelectorAll("[itemprop]")).filter((p) => p.parentElement?.closest("[itemscope]") === scope);
    for (const p of props) {
      const v = p.hasAttribute("itemscope") ? read(p) : p.getAttribute("content") ?? p.getAttribute("datetime") ?? p.getAttribute("href") ?? clean(p.textContent ?? "");
      for (const name of (p.getAttribute("itemprop") ?? "").split(/\s+/)) if (name && !(name in o)) o[name] = v;
    }
    return o;
  };
  return Array.from(doc.querySelectorAll("[itemscope][itemtype*='Flight']")).filter((el) => !el.parentElement?.closest("[itemscope][itemtype*='Flight']")).map(read);
}

interface Structured {
  flights: ExtractedFlight[];
  reservation: boolean;
  travellers?: number;
}

export function structuredData(doc: Document): Structured {
  const roots: unknown[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      roots.push(JSON.parse(s.textContent ?? ""));
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  roots.push(...microdata(doc));
  const flights = new Map<string, ExtractedFlight>();
  const names = new Map<string, Set<string>>();
  let reservation = false;
  const addFlight = (f: Json, price?: number, currency?: string, fare?: string, person?: string) => {
    const airline = obj(f.airline);
    const code = (str(airline?.iataCode) ?? "").toUpperCase();
    let fn = (str(f.flightNumber) ?? "").replace(/\s/g, "").toUpperCase();
    if (/^\d+$/.test(fn) && code) fn = code + fn;
    const date = (str(f.departureTime) ?? str(f.departureDate) ?? "").slice(0, 10);
    const origin = iata(f.departureAirport);
    const destination = iata(f.arrivalAirport);
    if (!/^[A-Z0-9]{2}\d{1,5}$/.test(fn) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !origin || !destination) return;
    fn = fn.slice(0, 2) + fn.slice(2).replace(/^0+(?=\d)/, "");
    const key = `${fn}|${date}`;
    const offer = obj(f.offers);
    const p = price ?? Number(str(offer?.price) ?? NaN);
    const cur = currency ?? str(offer?.priceCurrency);
    const prev = flights.get(key);
    flights.set(key, {
      flight_number: fn,
      departure_date: date,
      origin,
      destination,
      fare_class: fare ? fareClassIn(fare) : prev?.fare_class ?? "economy_light",
      displayed_price_minor: Number.isFinite(p) && p > 0 && (cur ?? "EUR").toUpperCase() === "EUR" ? Math.round(p * 100) : prev?.displayed_price_minor,
    });
    if (person) names.set(key, (names.get(key) ?? new Set()).add(person));
  };
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Json;
    const t = typeOf(o);
    if (t.includes("FlightReservation")) {
      reservation = true;
      const total = Number(str(o.totalPrice) ?? str(obj(o.totalPrice)?.price) ?? str(o.price) ?? NaN);
      const cur = str(o.priceCurrency) ?? str(obj(o.totalPrice)?.priceCurrency);
      const person = str(obj(o.underName)?.name) ?? str(o.underName);
      const fare = str(o.airplaneSeatClass) ?? str(obj(o.airplaneSeatClass)?.name) ?? str(o.fareBasis) ?? str(o.ticketType);
      const legs = Array.isArray(o.reservationFor) ? o.reservationFor : [o.reservationFor];
      // A total over several legs is not a per-flight price.
      for (const leg of legs) if (obj(leg)) addFlight(obj(leg)!, legs.length === 1 && Number.isFinite(total) ? total : undefined, cur, fare, person);
    } else if (t.includes("Flight")) addFlight(o);
    for (const [k, x] of Object.entries(o)) if (k === "@graph" || k === "itemListElement" || k === "item" || k === "subReservation" || k === "mainEntity") walk(x, depth + 1);
  };
  roots.forEach((r) => walk(r));
  const pax = Math.max(0, ...[...names.values()].map((s) => s.size));
  return { flights: [...flights.values()], reservation, travellers: pax || undefined };
}

/* ---------------------------------------------------------------- kinds */

const CONFIRMED = /\b(booking (?:is )?confirmed|booking confirmation|your (?:booking|trip|flight) is (?:confirmed|booked|complete)|thank(?:s| you) for (?:your )?(?:booking|order|purchase)|you(?:'|’)re all set|e-?ticket (?:number|receipt|issued)|boeking (?:is )?bevestigd|bedankt voor je boeking|bedankt voor uw boeking|buchungsbestätigung|vielen dank für ihre buchung|réservation (?:est )?confirmée|reserva confirmada|prenotazione confermata)\b/i;
const MANAGE_PATH = /(manage|\bmmb\b|my-?trips?|my-?bookings?|mytrips|retrieve|reservation\/view|booking\/view|trips\/[A-Z0-9]{5,}|mijn-?boeking|buchung-?verwalten)/i;
const BOOKING_REF = /\b(booking (?:reference|code|number)|reservation (?:code|number)|confirmation (?:code|number)|\bPNR\b|record locator|boekingsnummer|boekingscode|buchungsnummer|numéro de réservation|localizador|codice di prenotazione)\b/i;

const FLIGHTY = /\b(flights?|non-?stop|direct|vluchten|vlucht|rechtstreeks|flüge|flug|vuelos?|vols?|voli|voos?)\b/i;

/* -------------------------------------------------------------- extract */

const MAX_OCCURRENCES = 120;
const MAX_CLIMB = 10;

/** Elements whose own text holds a flight number ("KL1695", or "<b>KL</b> 1695" via a short parent). */
function occurrences(root: Element): { el: Element; fn: string }[] {
  const out: { el: Element; fn: string }[] = [];
  const done = new Set<Element>();
  const push = (el: Element, fns: string[]) => {
    for (const fn of fns) if (out.length < MAX_OCCURRENCES && !out.some((o) => o.el === el && o.fn === fn)) out.push({ el, fn });
  };
  const visit = (n: Node) => {
    if (out.length >= MAX_OCCURRENCES) return;
    if (n.nodeType === 3) {
      const v = n.nodeValue ?? "";
      const parent = n.parentElement;
      if (!parent || !/\d/.test(v)) return;
      const own = flightNumbersIn(clean(v));
      if (own.length) return push(parent, own);
      for (let a: Element | null = parent, i = 0; a && i < 2 && !done.has(a); a = a.parentElement, i++) {
        done.add(a);
        const t = clean(a.textContent ?? "");
        if (t.length > 32) break;
        const split = flightNumbersIn(t);
        if (split.length) return push(a, split);
      }
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (SKIP.has(el.tagName.toUpperCase()) || el.hasAttribute("hidden")) return;
    for (const c of Array.from(el.childNodes)) visit(c);
  };
  visit(root);
  return out;
}

export function extractGeneric(doc: Document, url: URL, opts: GenericOptions = {}): PageExtraction | null {
  const now = opts.now ?? new Date();
  const body = doc.body ?? doc.documentElement;
  if (!body) return null;
  const text = makeText();
  const pageText = text(body).slice(0, 400_000);
  const monthFirst = /^en-US/i.test(doc.documentElement?.getAttribute("lang") ?? "") || (/\.(?:com|us)$/i.test(url.hostname) && /\$\s?\d/.test(pageText) && !/€/.test(pageText));
  const hints = urlHints(url, now);
  const sd = structuredData(doc);

  // Page-level route and day: address first, then explicit "AMS → BCN" pairs, then <time>, then text.
  const pagePairs = pairsIn(pageText);
  const pageRoute: [string, string] | null =
    hints.origin && hints.destination ? [hints.origin, hints.destination] : mostCommon(pagePairs.map((p) => p.join("-")))?.split("-") as [string, string] ?? null;
  const timeDates = Array.from(doc.querySelectorAll("time[datetime]")).map((t) => parseDateValue(t.getAttribute("datetime") ?? "", now)).filter(Boolean) as string[];
  const textDates = datesIn(pageText, now, monthFirst).filter((d) => Date.parse(d) >= now.getTime() - 2 * 86400_000);
  const pageDate = hints.date ?? mostCommon(timeDates) ?? mostCommon(textDates);

  let flights: ExtractedFlight[] = sd.flights;
  if (!flights.length) {
    const seen = new Map<string, ExtractedFlight & { priced: boolean }>();
    for (const { el, fn } of occurrences(body)) {
      // Walk up to the result card: the first ancestor with a price, unless it already holds
      // another flight (then the price belongs to a whole itinerary).
      let scope: Element = el;
      let card: Element | null = null;
      for (let a: Element | null = el, i = 0; a && a !== body && i < MAX_CLIMB; a = a.parentElement, i++) {
        const t = text(a);
        if (flightNumbersIn(t).some((x) => x !== fn)) break;
        scope = a;
        if (parseMoney(t).some((m) => m.minor >= 1000)) {
          card = a;
          break;
        }
      }
      const t = text(card ?? scope);
      const r = routeIn(t) ?? routeNear(scope, fn, text) ?? pageRoute;
      const timeEl = (card ?? scope).querySelector("time[datetime]");
      const date = (timeEl && parseDateValue(timeEl.getAttribute("datetime") ?? "", now)) || datesIn(t, now, monthFirst)[0] || pageDate;
      if (!r || !date || r[0] === r[1]) continue;
      // Ignore small add-ons ("+€9 seat") next to the fare.
      const eur = card ? parseMoney(t).filter((m) => m.currency === "EUR" && m.minor >= 1000).map((m) => m.minor) : [];
      const key = `${fn}|${date}`;
      const f = { flight_number: fn, departure_date: date, origin: r[0], destination: r[1], fare_class: fareClassIn(t), displayed_price_minor: eur.length ? Math.min(...eur) : undefined, priced: !!card };
      const prev = seen.get(key);
      if (!prev || (!prev.priced && f.priced)) seen.set(key, f);
    }
    const all = [...seen.values()];
    // On result lists, flights inside a priced card are bookable as such; legs of connections are not.
    const priced = all.filter((f) => f.priced);
    flights = (priced.length ? priced : all).map(({ priced: _p, ...f }) => f);
  }

  // A route taken from the address alone also needs the page to look like flights on that route.
  const routeOnPage = !!pageRoute && (pagePairs.length > 0 || airportsIn(pageText).some((c) => pageRoute.includes(c)) || FLIGHTY.test(pageText));
  const route: RouteHint | undefined = pageRoute && pageDate && (flights.length || routeOnPage) ? { origin: pageRoute[0], destination: pageRoute[1], departure_date: pageDate } : undefined;
  if (!flights.length && !route) return null;

  const path = url.pathname + url.hash;
  let kind: PageExtraction["kind"];
  if (MANAGE_PATH.test(path) && (sd.reservation || BOOKING_REF.test(pageText)) && flights.length) kind = "manage";
  else if ((sd.reservation || CONFIRMED.test(pageText)) && flights.length >= 1 && flights.length <= 4) kind = "confirmation";
  else if (flights.length === 1) kind = "details";
  else kind = "search";
  return { kind, flights, travellers: sd.travellers ?? hints.travellers ?? travellersIn(pageText), route };
}

/** A leg without codes in its own box ("KL1695 · 07:20 – 09:40"): look a few levels further up. */
function routeNear(scope: Element, fn: string, text: (n: Node) => string): [string, string] | null {
  for (let a = scope.parentElement, i = 0; a && i < 3; a = a.parentElement, i++) {
    const t = text(a);
    if (flightNumbersIn(t).some((x) => x !== fn)) return null;
    const r = routeIn(t);
    if (r) return r;
  }
  return null;
}

function travellersIn(text: string): number | undefined {
  const m = /\b([1-9])\s+(?:adults?|passengers?|travell?ers?|volwassenen?|reizigers?|erwachsene?r?|reisende|adultes?|adultos?|adulti|passagiers?)\b/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

function mostCommon(xs: string[]): string | undefined {
  const n = new Map<string, number>();
  let best: string | undefined;
  for (const x of xs) {
    n.set(x, (n.get(x) ?? 0) + 1);
    if (!best || n.get(x)! > n.get(best)!) best = x;
  }
  return best;
}

export const genericSite: SiteAdapter = {
  id: "generic",
  matches: () => true,
  extract: (doc, url) => extractGeneric(doc, url),
};
