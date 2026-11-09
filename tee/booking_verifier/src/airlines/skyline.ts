/**
 * Skyline Travel (demo) — CapFare's mock booking site. Parsers for its confirmation emails and
 * for its manage-booking page. Only demo deployments trust its DKIM domain (.example has no DNS;
 * the demo resolver fetches the key from the booking site, see demo-dns.ts).
 */
import type { BookingStatus } from "@capfare/shared";
import type { AirlineAdapter, ParsedBooking, ParsedSegment } from "./types.ts";
import { normDate, normFare, parseEurAmount } from "./types.ts";

export const SKYLINE_DOMAIN = "skyline-travel.example";

function line(text: string, label: string): string | null {
  const m = new RegExp(`^${label}:\\s*(.+)$`, "im").exec(text);
  return m ? m[1].trim() : null;
}

const refundOf = (t: string | null | undefined) =>
  /^refundable/i.test(t ?? "") ? "refundable" : /non-refundable/i.test(t ?? "") ? "non_refundable" : "unknown";

/** One flight block: "<prefix>Flight:", "<prefix>Date:", "<prefix>Fare:", ... */
function emailSegment(text: string, prefix: string): ParsedSegment | null | undefined {
  const flight = line(text, `${prefix}Flight`);
  if (!flight) return undefined;
  // The flight date line ("Date: 14 Jun 2027, departs …"), not the email's Date header.
  const date = new RegExp(`^${prefix}Date:\\s*(\\d{1,2}\\s+[A-Za-z]{3}\\s+\\d{4}.*)$`, "im").exec(text)?.[1] ?? null;
  const fare = line(text, `${prefix}Fare`);
  const price = line(text, `${prefix}Price per passenger`);
  const fm = /^([A-Z0-9]{2}\d{1,5})\b.*\(([A-Z]{3})\).*\(([A-Z]{3})\)/.exec(flight);
  const d = date ? normDate(date) : null;
  const fc = fare ? normFare(fare) : null;
  const paid = price ? parseEurAmount(price) : null;
  if (!fm || !d || !fc || !paid) return null;
  return { flight_number: fm[1], departure_date: d, origin: fm[2], destination: fm[3], fare_class: fc, paid_price_minor: paid, refundable: refundOf(line(text, `${prefix}Ticket type`)) };
}

export function parseSkylineEmail(text: string): ParsedBooking | null {
  const ref = line(text, "Booking code");
  const lead = line(text, "Lead passenger");
  if (!ref || !lead) return null;
  // One-way: "Flight:", "Date:", ...; return trips: "Outbound flight:" and "Return flight:" blocks.
  const blocks = line(text, "Outbound flight") ? ["Outbound ", "Return "] : [""];
  const segments: ParsedSegment[] = [];
  for (const b of blocks) {
    const seg = emailSegment(text, b);
    if (seg === null) return null;
    if (seg) segments.push(seg);
  }
  if (!segments.length) return null;
  const pax = Number(line(text, "Passengers") ?? "1");
  return {
    airline: segments[0].flight_number.slice(0, 2),
    booking_ref: ref,
    // Airline style: SURNAME/FIRSTNAME TITLE
    last_name: lead.includes("/") ? lead.split("/")[0].trim() : lead.split(/\s+/).pop(),
    segments,
    paid_price_minor: segments[0].paid_price_minor!,
    currency: "EUR",
    refundable: segments[0].refundable ?? "unknown",
    passengers: Number.isInteger(pax) && pax > 0 ? pax : 1,
  };
}

export const skyline: AirlineAdapter = {
  code: "SKY",
  name: "Skyline Travel (demo)",
  dkimDomains: [SKYLINE_DOMAIN],
  parseEml: (text) => parseSkylineEmail(text),
  statusAccess: "none",
};

/** Reads the manage-booking page (the "booking-facts" list) as served by the booking site. */
export function parseSkylineManagePage(html: string): { booking: ParsedBooking; status: BookingStatus; booked_at: number } | null {
  const facts = /<dl[^>]*class="[^"]*booking-facts[^"]*"[^>]*>([\s\S]*?)<\/dl>/.exec(html);
  if (!facts) return null;
  const get = (k: string) => new RegExp(`<dd[^>]*data-k="${k}"[^>]*>([\\s\\S]*?)<\\/dd>`).exec(facts[1])?.[1] ?? "";
  const text = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const ref = text(get("ref"));
  const last = text(/<span class="sk-last">([\s\S]*?)<\/span>/.exec(get("lead"))?.[1] ?? "");
  const statusText = text(get("status")).toLowerCase();
  const booked = /datetime="([^"]+)"/i.exec(get("booked"))?.[1];
  const pax = Number(text(get("pax")) || "1");
  // Flight 1 uses the plain keys; a return flight the same keys with "-2".
  const segments: ParsedSegment[] = [];
  for (const sfx of ["", "-2"]) {
    const fn = text(/class="sk-fn">([\s\S]*?)</.exec(get(`flight${sfx}`))?.[1] ?? "");
    if (!fn) {
      if (sfx === "") return null;
      break;
    }
    const route = /([A-Z]{3})\s*(?:→|&rarr;|-&gt;)\s*([A-Z]{3})/.exec(text(get(`route${sfx}`)));
    const dep = /datetime="(\d{4}-\d{2}-\d{2})T/i.exec(get(`departure${sfx}`))?.[1];
    const fc = normFare(text(get(`fare${sfx}`)));
    const paid = parseEurAmount(text(get(`price${sfx}`)).replace("€ ", "€"));
    const ticket = text(get(`ticket${sfx}`)).toLowerCase();
    if (!route || !dep || !fc || !paid) return null;
    segments.push({
      flight_number: fn, departure_date: dep, origin: route[1], destination: route[2], fare_class: fc, paid_price_minor: paid,
      refundable: ticket.startsWith("refundable") ? "refundable" : ticket.startsWith("non-refundable") ? "non_refundable" : "unknown",
    });
  }
  if (!ref || !last || !booked) return null;
  return {
    booking: {
      airline: segments[0].flight_number.slice(0, 2),
      booking_ref: ref,
      last_name: last,
      segments,
      paid_price_minor: segments[0].paid_price_minor!,
      currency: "EUR",
      refundable: segments[0].refundable ?? "unknown",
      passengers: Number.isInteger(pax) && pax > 0 ? pax : 1,
    },
    status: statusText.includes("cancelled") ? "cancelled" : statusText.includes("confirmed") ? "active" : "unknown",
    booked_at: Math.floor(new Date(booked).getTime() / 1000),
  };
}
