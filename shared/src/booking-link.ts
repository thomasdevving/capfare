/**
 * Reading flights from booking-site text and addresses: flight numbers of known airlines,
 * known airport codes, dates in seven languages, and the search in a booking site's link
 * (query, hash, path, and Google Flights' encoded "tfs" parameter). Used by the extension's
 * generic page reader and by "Paste a link" on the web app. Pure; hints only.
 */
import { AIRLINES, AIRPORTS } from "./iata.ts";

/* ------------------------------------------------------- flight numbers */

const FN_RE = /(?<![A-Za-z0-9:.,/€$£#-])([A-Z0-9]{2})\s?(\d{1,4})(?![0-9]|[:.,]\d|\s?(?:kg|km|h\b|min|%|x\b|°))/g;

function normFn(prefix: string, num: string): string | null {
  if (!AIRLINES.has(prefix) || !/[A-Z]/.test(prefix)) return null;
  if (prefix === "A3" && num.length < 3) return null; // Airbus A319-A380, not Aegean
  return prefix + num.replace(/^0+(?=\d)/, "");
}

export function flightNumbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FN_RE)) {
    const fn = normFn(m[1], m[2]);
    if (fn && !out.includes(fn)) out.push(fn);
  }
  return out;
}

/* -------------------------------------------------------------- airports */

const ARROW = "\\s*(?:→|->|–|—|-|>|›|»|✈|to|naar|nach|à|a|vers)\\s*";
const PAIR_RE = new RegExp(`(?<![A-Za-z])([A-Z]{3})(?:\\s*\\)|\\s+[A-Z][a-z]+)?${ARROW}(?:[A-Z][\\p{L} .'-]{0,40}?\\(\\s*)?([A-Z]{3})(?![A-Za-z])`, "gu");
const CODE_RE = /(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g;

export const isAirport = (c: string) => AIRPORTS.has(c);

/** Known airport codes in order of first appearance. */
export function airportsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CODE_RE)) if (isAirport(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/** "AMS → BCN", "AMS-BCN", "Amsterdam (AMS) to Barcelona (BCN)": explicit pairs, in order. */
export function pairsIn(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of text.matchAll(PAIR_RE)) if (isAirport(m[1]) && isAirport(m[2]) && m[1] !== m[2]) out.push([m[1], m[2]]);
  return out;
}

export function routeIn(text: string): [string, string] | null {
  const p = pairsIn(text)[0];
  if (p) return p;
  const codes = airportsIn(text);
  return codes.length === 2 ? [codes[0], codes[1]] : null;
}

/* ----------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {};
const addMonths = (names: string) => names.split(" ").forEach((g, i) => g.split("|").forEach((n) => (MONTHS[n] = i + 1)));
addMonths("jan|january|januari|januar|janv|janvier|ene|enero|gen|gennaio|janeiro feb|february|februari|februar|févr|fevr|février|fevrier|febrero|febbraio|fev|fevereiro mar|march|maart|mrt|märz|mär|maerz|mars|marzo|março|marco apr|april|avr|avril|abr|abril|aprile may|mei|mai|mayo|mag|maggio|maio jun|june|juni|juin|junio|giu|giugno|junho jul|july|juli|juil|juillet|julio|lug|luglio|julho aug|august|augustus|août|aout|agosto sep|sept|september|septembre|septiembre|settembre|setembro oct|october|oktober|okt|octobre|octubre|ott|ottobre|outubro nov|november|novembre|noviembre|novembro dec|december|dezember|dez|déc|dec|décembre|decembre|diciembre|dic|dicembre|dezembro");
/** Month words that are also ordinary words: only accepted when capitalised. */
const WORDY = new Set(["may", "mai", "mei", "mar", "mars"]);
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const D_M_Y = new RegExp(`(?<![\\d\\p{L}])(\\d{1,2})(?:st|nd|rd|th|e|er|\\.)?\\s+(?:de\\s+)?(${MONTH_ALT})\\.?(?![\\p{L}])(?:,?\\s+(?:de\\s+)?(20\\d{2}))?`, "giu");
const M_D_Y = new RegExp(`(?<![\\p{L}])(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d\\p{L}:])(?:,?\\s+(20\\d{2}))?`, "giu");
const ISO = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g;
const NUMERIC = /(?<![\d./-])(\d{1,2})([./-])(\d{1,2})\2(20\d{2})(?![\d])/g;

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
/** A date shown without a year is the next one from today (a day of slack for time zones). */
function withYear(m: number, d: number, now: Date): string | null {
  const y = now.getUTCFullYear();
  const s = ymd(y, m, d);
  if (!s) return ymd(y + 1, m, d);
  return Date.parse(s) < now.getTime() - 2 * 86400_000 ? ymd(y + 1, m, d) : s;
}
const monthOf = (word: string): number | undefined => {
  const lw = word.toLowerCase();
  if (WORDY.has(lw) && word[0] !== word[0].toUpperCase()) return undefined;
  return MONTHS[lw];
};

/** Every date in `text`, in order of appearance. `monthFirst` reads 06/14/2027 as US style. */
export function datesIn(text: string, now: Date, monthFirst = false): string[] {
  const found: { at: number; d: string }[] = [];
  const add = (at: number, d: string | null) => d && found.push({ at, d });
  for (const m of text.matchAll(ISO)) add(m.index!, ymd(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(D_M_Y)) {
    const mo = monthOf(m[2]);
    if (mo) add(m.index!, m[3] ? ymd(+m[3], mo, +m[1]) : withYear(mo, +m[1], now));
  }
  for (const m of text.matchAll(M_D_Y)) {
    const mo = monthOf(m[1]);
    if (mo) add(m.index!, m[3] ? ymd(+m[3], mo, +m[2]) : withYear(mo, +m[2], now));
  }
  for (const m of text.matchAll(NUMERIC)) {
    const [a, b] = [+m[1], +m[3]];
    const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : monthFirst ? [b, a] : [a, b];
    add(m.index!, ymd(+m[4], mo, d));
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.d);
}

/** Date values in URLs and attributes: 2027-06-14, 20270614, 270614 (yymmdd), 14/06/2027. */
export function parseDateValue(v: string, now: Date): string | null {
  const s = v.trim();
  let m = /^(20\d{2})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return ymd(2000 + +m[1], +m[2], +m[3]);
  return datesIn(s, now)[0] ?? null;
}

/* --------------------------------------------------------- page address */

const P_FROM = "from origin orig org departure dep departureairport departure_airport fromairport from_airport originairport origin_airport flyfrom fly_from o source src origincode leavingfrom depart_from outboundfrom";
const P_TO = "to destination dest dst arrival arr arrivalairport arrival_airport toairport to_airport destinationairport destination_airport flyto fly_to d target destinationcode goingto arrive_at outboundto";
const P_DATE = "date depart departure departdate departuredate departure_date depart_date outbounddate outbound_date outbound d1 departing startdate start_date fromdate from_date leavedate date1 dep_date flightdate when";
const P_RET = "return returndate return_date ret retdate inbound inbounddate inbound_date d2 returning enddate end_date date2 todate to_date";
const P_FN = "flight flightnumber flight_number flightno fn flightnum";
const P_ADULTS = "adults adult adt adultsv2 numadults num_adults adultcount nadults pax passengers travellers travelers persons seats";
const P_KIDS = "children child chd kids childrenv2 numchildren youth yth";
const keys = (s: string) => new Set(s.split(" "));
const [K_FROM, K_TO, K_DATE, K_RET, K_FN, K_ADULTS, K_KIDS] = [P_FROM, P_TO, P_DATE, P_RET, P_FN, P_ADULTS, P_KIDS].map(keys);

const codeIn = (v: string): string | undefined => {
  for (const m of v.matchAll(/(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g)) if (isAirport(m[1].toUpperCase())) return m[1].toUpperCase();
  return undefined;
};
const countOf = (v: string): number => (/^\d+$/.test(v) ? Number(v) : v.split(/[|,;-]/).filter((x) => /^\d+$/.test(x)).length);

export interface UrlHints {
  origin?: string;
  destination?: string;
  date?: string;
  /** Return date, for a return trip. */
  return_date?: string;
  /** Flight number, if the link names one. */
  flight_number?: string;
  travellers?: number;
}

/**
 * Google Flights keeps the search in "tfs", a base64url protobuf in which dates and airport
 * codes are plain ASCII strings ("2027-06-14", "AMS", "BCN" per leg). Other sites with an
 * opaque search token sometimes do the same, so any long base64url value is tried.
 */
function fromOpaque(v: string): { dates: string[]; codes: string[] } | null {
  if (v.length < 16 || !/^[A-Za-z0-9_-]+={0,2}$/.test(v)) return null;
  let bin: string;
  try {
    bin = atob(v.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "").padEnd(Math.ceil(v.replace(/=+$/, "").length / 4) * 4, "="));
  } catch {
    return null;
  }
  const dates = [...bin.matchAll(/(20\d{2}-\d{2}-\d{2})/g)].map((m) => m[1]);
  // Length-prefixed 3-byte strings (protobuf: tag, 0x03, code).
  const codes = [...bin.matchAll(/\x03([A-Z]{3})/g)].map((m) => m[1]).filter(isAirport);
  return dates.length && codes.length >= 2 ? { dates, codes } : null;
}

export function urlHints(url: URL, now: Date): UrlHints {
  const h: UrlHints = {};
  let adults: number | undefined;
  let kids = 0;
  let opaque: { dates: string[]; codes: string[] } | null = null;
  // Query and hash parameters (single-page apps often keep the search in the hash).
  const params = new URLSearchParams(url.search);
  const hash = url.hash.includes("=") ? new URLSearchParams(url.hash.replace(/^#!?\/?[^?]*\?/, "").replace(/^#/, "")) : null;
  for (const src of [params, hash]) {
    if (!src) continue;
    for (const [k0, v] of src) {
      const k = k0.toLowerCase();
      if (!h.origin && K_FROM.has(k)) h.origin = codeIn(v);
      else if (!h.destination && K_TO.has(k)) h.destination = codeIn(v);
      if (!h.date && K_DATE.has(k)) h.date = parseDateValue(v, now) ?? undefined;
      if (!h.return_date && K_RET.has(k)) h.return_date = parseDateValue(v, now) ?? undefined;
      if (!h.flight_number && K_FN.has(k)) h.flight_number = flightNumbersIn(v.toUpperCase())[0];
      if (adults === undefined && K_ADULTS.has(k) && countOf(v) > 0) adults = countOf(v);
      // Some sites list children's ages ("childrenv2=5|8"): count entries, not the number.
      if (K_KIDS.has(k)) kids += k.endsWith("v2") ? v.split(/[|,;]/).filter((x) => /^\d+$/.test(x)).length : countOf(v);
      opaque ??= fromOpaque(v);
    }
  }
  // Path: /flights/AMS-BCN/2027-06-14/2027-06-21, /transport/flights/ams/bcn/270614/, /AMS/BCN/20270614.
  const segs = url.pathname.split("/").filter(Boolean).map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const pair = /^([A-Za-z]{3})[-_]([A-Za-z]{3})(?:[,-]|$)/.exec(s);
    if (!h.origin && pair && isAirport(pair[1].toUpperCase()) && isAirport(pair[2].toUpperCase())) {
      h.origin = pair[1].toUpperCase();
      h.destination = pair[2].toUpperCase();
    } else if (!h.origin && /^[A-Za-z]{3}$/.test(s) && /^[A-Za-z]{3}$/.test(segs[i + 1] ?? "") && isAirport(s.toUpperCase()) && isAirport(segs[i + 1].toUpperCase())) {
      h.origin = s.toUpperCase();
      h.destination = segs[i + 1].toUpperCase();
    }
    if (/^(20\d{2}-\d{2}-\d{2}|\d{6}|20\d{6})$/.test(s)) {
      const d = parseDateValue(s, now) ?? undefined;
      if (!h.date) h.date = d;
      else if (!h.return_date && d && d > h.date) h.return_date = d;
    }
    if (!h.flight_number && /^[A-Za-z0-9]{2}-?\d{1,4}$/.test(s)) h.flight_number = flightNumbersIn(s.toUpperCase().replace("-", ""))[0];
  }
  if (opaque && !h.origin) {
    h.origin = opaque.codes[0];
    h.destination = opaque.codes.find((c) => c !== opaque!.codes[0]);
    h.date ??= opaque.dates[0];
    if (opaque.dates[1] && opaque.dates[1] > opaque.dates[0]) h.return_date ??= opaque.dates[1];
  }
  if (h.origin && h.origin === h.destination) delete h.destination;
  if (h.return_date && h.date && h.return_date <= h.date) delete h.return_date;
  if (adults !== undefined) h.travellers = adults + kids;
  for (const k of Object.keys(h) as (keyof UrlHints)[]) if (h[k] === undefined) delete h[k];
  return h;
}

/**
 * A link someone pasted or shared (it may come with other text, as share sheets add a title).
 * Returns what the link says about the search, or null if it has no URL or nothing useful.
 */
export function parseBookingLink(input: string, now: Date = new Date()): (UrlHints & { url: string }) | null {
  const m = /https?:\/\/[^\s<>"']+/i.exec(input.trim());
  if (!m) return null;
  let url: URL;
  try {
    url = new URL(m[0].replace(/[).,;]+$/, ""));
  } catch {
    return null;
  }
  const h = urlHints(url, now);
  return h.origin || h.date || h.flight_number ? { ...h, url: url.toString() } : null;
}
