import type { BookingStatus, Refundability } from "@capfare/shared";

export interface ParsedSegment {
  flight_number: string;
  departure_date: string; // YYYY-MM-DD
  origin: string;
  destination: string;
  fare_class: string; // normalised
  /** Price of this flight per traveller, when the booking shows it per flight. */
  paid_price_minor?: number;
  /** Ticket type of this flight, when the booking shows it per flight. */
  refundable?: Refundability;
}

/** Parsed booking. Contains PII (booking_ref, last_name): never leaves the enclave. */
export interface ParsedBooking {
  airline: string;
  booking_ref: string;
  last_name?: string;
  segments: ParsedSegment[];
  /**
   * Price per traveller for the whole booking. Used for a flight only when the booking has
   * a single flight; with several flights each segment must carry its own price.
   */
  paid_price_minor: number;
  currency: string;
  refundable: Refundability;
  /** Travellers on the booking (default 1). */
  passengers?: number;
}

export interface StatusResult {
  status: BookingStatus;
  booking: ParsedBooking;
}

export interface AirlineAdapter {
  code: string; // IATA
  name: string;
  /** DKIM signing domains accepted for this airline's confirmation emails. */
  dkimDomains: string[];
  parseEml(text: string, html: string | undefined): ParsedBooking | null;
  /** "live" only if the airline permits automated access to manage-booking. */
  statusAccess: "live" | "demo-only" | "none";
  checkStatus?(bookingRef: string, lastName: string): Promise<StatusResult>;
}

export const FARE_NAMES: Record<string, string> = {
  "economy light": "economy_light",
  "economy standard": "economy_standard",
  "economy flex": "economy_flex",
  "premium comfort": "premium_economy",
  "premium economy": "premium_economy",
  business: "business",
  "business class": "business",
};

export function normFare(s: string): string | null {
  return FARE_NAMES[s.trim().toLowerCase()] ?? null;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "14 Jun 2027" | "2027-06-14" -> "2027-06-14" */
export function normDate(s: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

export function parseEurAmount(s: string): number | null {
  const m = /(?:EUR|€)\s*([0-9]{1,3}(?:[.,\s]?[0-9]{3})*)(?:[.,]([0-9]{2}))?/.exec(s);
  if (!m) return null;
  return Number(m[1].replace(/[.,\s]/g, "")) * 100 + Number(m[2] ?? 0);
}
