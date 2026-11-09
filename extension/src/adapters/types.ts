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

export interface PageExtraction {
  kind: "search" | "details" | "confirmation" | "manage";
  flights: ExtractedFlight[];
  /** Travellers in the search or on the booking, if the page shows it. */
  travellers?: number;
}

export interface SiteAdapter {
  id: string;
  /** Hostname + path test. */
  matches(url: URL): boolean;
  extract(doc: Document, url: URL): PageExtraction | null;
}

export function parseEuro(text: string): number | undefined {
  const m = /€\s*([0-9]{1,3}(?:[.\s][0-9]{3})*|[0-9]+)(?:[,.]([0-9]{2}))?/.exec(text);
  if (!m) return undefined;
  return Number(m[1].replace(/[.\s]/g, "")) * 100 + Number(m[2] ?? 0);
}
