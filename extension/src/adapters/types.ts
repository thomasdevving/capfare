/** A site adapter extracts the flight and the displayed price from a page. Hints only:
 *  premiums and payouts always use oracle snapshots and verified bookings. */
export interface ExtractedFlight {
  flight_number: string;
  departure_date: string; // YYYY-MM-DD
  origin: string;
  destination: string;
  fare_class: string;
  displayed_price_minor?: number;
}

/** Route and day of the search, when the page shows no flight numbers (route cover). */
export interface RouteHint {
  origin: string;
  destination: string;
  departure_date: string;
}

export interface PageExtraction {
  kind: "search" | "details" | "confirmation" | "manage";
  flights: ExtractedFlight[];
  /** Travellers in the search or on the booking, if the page shows it. */
  travellers?: number;
  /** Route and day the page is about (search pages without flight numbers rely on it). */
  route?: RouteHint;
}

export interface SiteAdapter {
  id: string;
  /** Hostname + path test. */
  matches(url: URL): boolean;
  extract(doc: Document, url: URL): PageExtraction | null;
  /** CapFare's booking checker can load this site's booking pages ("Verify with CapFare"). */
  liveCheck?: boolean;
}

export function parseEuro(text: string): number | undefined {
  const m = /€\s*([0-9]{1,3}(?:[.\s][0-9]{3})*|[0-9]+)(?:[,.]([0-9]{2}))?/.exec(text);
  if (!m) return undefined;
  return Number(m[1].replace(/[.\s]/g, "")) * 100 + Number(m[2] ?? 0);
}

export interface Money {
  minor: number;
  currency: "EUR" | "GBP" | "USD" | "CHF" | "SEK" | "NOK" | "DKK" | "PLN" | "CZK";
}

const CUR: Record<string, Money["currency"]> = {
  "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP", $: "USD", us$: "USD", usd: "USD", chf: "CHF",
  sek: "SEK", nok: "NOK", dkk: "DKK", pln: "PLN", "zł": "PLN", czk: "CZK", "kč": "CZK",
};
const SYM = "US\\$|€|£|\\$|EUR|GBP|USD|CHF|SEK|NOK|DKK|PLN|CZK|zł|Kč";
const AMOUNT = "\\d{1,3}(?:[.,\\s\\u00a0\\u202f']\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const MONEY_RE = new RegExp(`(?:(${SYM})\\s?(${AMOUNT})(?:,-|\\.-)?|(${AMOUNT})(?:,-)?\\s?(${SYM}))(?![\\d])`, "gi");

/** "1.234,50", "1,234.50", "1 234", "170", "170,5" → minor units. */
function amountMinor(raw: string): number | undefined {
  const s = raw.replace(/[\s\u00a0\u202f']/g, "");
  const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return undefined;
  const whole = m[1].replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return undefined;
  const frac = m[2] ? (m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2])) : 0;
  return Number(whole) * 100 + frac;
}

/** Every price shown in `text`, in order. */
export function parseMoney(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const cur = CUR[(m[1] ?? m[4]).toLowerCase()];
    const minor = amountMinor(m[2] ?? m[3]);
    if (cur && minor !== undefined && minor > 0) out.push({ minor, currency: cur });
  }
  return out;
}
