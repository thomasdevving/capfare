/**
 * KLM confirmation-email template parser.
 *
 * IMPORTANT: written against CapFare's own synthetic fixture layout (see test/fixtures.ts),
 * not against real KLM emails, which we have not been able to inspect at scale. It must be
 * validated with real confirmation emails before relying on it. The DKIM domain list is
 * the part that matters for security; the parser only extracts fields.
 *
 * Manage-booking status checks: KLM's website terms do not permit automated access, so the
 * live status adapter is not implemented (statusAccess "demo-only" via the demo airline).
 */
import type { AirlineAdapter, ParsedBooking, ParsedSegment } from "./types.ts";
import { normDate, normFare, parseEurAmount } from "./types.ts";

function field(text: string, label: RegExp): string | null {
  const m = new RegExp(`(?:${label.source})\\s*[:\\-]?\\s*(.+)`, "i").exec(text);
  return m ? m[1].trim() : null;
}

export function parseKlmText(text: string): ParsedBooking | null {
  const ref = field(text, /Booking code|Boekingscode/);
  const refM = ref ? /^([A-Z0-9]{6})\b/.exec(ref) : null;
  if (!refM) return null;
  const segments: ParsedSegment[] = [];
  // Segment lines: "KL1695 · 14 Jun 2027 · Amsterdam (AMS) → Barcelona (BCN) · Economy Light"
  const segRe = /\b(KL\d{1,5})\b[^\n]*?(\d{1,2}\s+[A-Za-z]{3}[a-z]*\.?\s+\d{4}|\d{4}-\d{2}-\d{2})[^\n]*?\(([A-Z]{3})\)[^\n]*?\(([A-Z]{3})\)[^\n]*?(Economy Light|Economy Standard|Economy Flex|Premium Comfort|Premium Economy|Business(?: Class)?)/gi;
  for (const m of text.matchAll(segRe)) {
    const date = normDate(m[2]);
    const fare = normFare(m[5]);
    if (date && fare) segments.push({ flight_number: m[1].toUpperCase(), departure_date: date, origin: m[3], destination: m[4], fare_class: fare });
  }
  if (!segments.length) return null;
  const totalLine = field(text, /Total price|Totaalprijs/);
  const total = totalLine ? parseEurAmount(totalLine) : null;
  if (!total) return null;
  // "Passengers: 2" / "Passagiers: 2"; the total covers all of them.
  const paxLine = field(text, /Passengers|Passagiers/);
  const passengers = paxLine && /^\d+\b/.test(paxLine) ? Math.max(1, parseInt(paxLine, 10)) : 1;
  const paid = Math.floor(total / passengers);
  const lower = text.toLowerCase();
  const refundable = /non-refundable|not refundable|niet restitueerbaar/.test(lower)
    ? "non_refundable"
    : /fully refundable|refundable ticket|restitueerbaar/.test(lower)
      ? "refundable"
      : "unknown";
  const last = field(text, /Passenger(?!s)|Passagier(?!s)/);
  return {
    airline: "KL",
    booking_ref: refM[1],
    // "SURNAME/FIRSTNAME TITLE" (airline style); fall back to the last word.
    last_name: last ? (last.includes("/") ? last.split("/")[0].trim() : last.split(/\s+/).pop()?.replace(/[^A-Za-zÀ-ÿ'-]/g, "")) : undefined,
    segments,
    paid_price_minor: paid,
    currency: "EUR",
    refundable,
    passengers,
  };
}

export const klm: AirlineAdapter = {
  code: "KL",
  name: "KLM",
  dkimDomains: ["klm.com", "klm.nl", "info.klm.com"],
  parseEml: (text) => parseKlmText(text),
  statusAccess: "none",
};
