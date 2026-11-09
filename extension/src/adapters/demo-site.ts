/**
 * Adapter for the CapFare demo booking site (/demo-airline on the CapFare web app).
 * It reads the page the way an adapter for a real site would: from visible structure
 * (cards, labels, prices), not from CapFare-specific data.
 */
import { parseEuro, type ExtractedFlight, type PageExtraction, type SiteAdapter } from "./types.ts";

const FARES: Record<string, string> = {
  "economy light": "economy_light",
  "economy standard": "economy_standard",
  "economy flex": "economy_flex",
};

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function fromCard(card: Element): ExtractedFlight[] {
  const fn = text(card.querySelector(".fl-number")).toUpperCase().replace(/\s/g, "");
  const t = card.querySelector("time");
  const date = (t?.getAttribute("datetime") ?? t?.getAttribute("dateTime") ?? "").slice(0, 10);
  const route = text(card.querySelector(".fl-route"));
  const m = /\b([A-Z]{3})\b.*?\b([A-Z]{3})\b/.exec(route);
  if (!fn || !date || !m) return [];
  return [...card.querySelectorAll(".fare")].map((f) => ({
    flight_number: fn,
    departure_date: date,
    origin: m[1],
    destination: m[2],
    fare_class: FARES[text(f.querySelector(".fare-name")).toLowerCase()] ?? "economy_light",
    displayed_price_minor: parseEuro(text(f.querySelector(".fare-price"))),
  }));
}

export const demoSite: SiteAdapter = {
  id: "capfare-demo-site",
  matches: (u) => u.pathname.startsWith("/demo-airline"),
  extract(doc, url) {
    const conf = doc.querySelector(".booking-confirmed");
    if (conf) {
      const flights = fromCard(conf).filter((f) => f.displayed_price_minor !== undefined);
      return { kind: "confirmation", flights };
    }
    const cards = [...doc.querySelectorAll(".flight-card")];
    if (!cards.length) return null;
    const flights = cards.flatMap(fromCard);
    return { kind: url.pathname.includes("/flight") ? "details" : "search", flights };
  },
};
