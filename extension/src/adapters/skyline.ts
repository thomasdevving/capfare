/**
 * Adapter for Skyline Travel (demo), CapFare's mock booking site at /booker on the CapFare app.
 * Reads the page the way an adapter for a real site would: from visible structure.
 */
import { parseEuro, type ExtractedFlight, type PageExtraction, type SiteAdapter } from "./types.ts";

const FARES: Record<string, string> = { "economy light": "economy_light", "economy standard": "economy_standard", "economy flex": "economy_flex" };
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const dateOf = (root: Element) => {
  const t = root.querySelector("time");
  return (t?.getAttribute("datetime") ?? t?.getAttribute("dateTime") ?? "").slice(0, 10);
};
const route = (root: Element) => /\b([A-Z]{3})\b.*?\b([A-Z]{3})\b/.exec(text(root.querySelector(".sk-route")));

function base(root: Element): Omit<ExtractedFlight, "fare_class" | "displayed_price_minor"> | null {
  const fn = text(root.querySelector(".sk-fn")).toUpperCase().replace(/\s/g, "");
  const r = route(root);
  const d = dateOf(root);
  return fn && r && d ? { flight_number: fn, departure_date: d, origin: r[1], destination: r[2] } : null;
}

const paxOf = (url: URL, facts?: Element | null): number | undefined => {
  const n = Number(text(facts?.querySelector('[data-k="pax"]')) || url.searchParams.get("pax") || "");
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export const skylineSite: SiteAdapter = {
  id: "skyline-travel-demo",
  liveCheck: true,
  matches: (u) => u.pathname.startsWith("/booker"),
  extract(doc, url) {
    const manage = doc.querySelector(".manage-booking");
    const confirmed = doc.querySelector(".booking-confirmed");
    const facts = (manage ?? confirmed)?.querySelector(".booking-facts");
    if (facts) {
      const b = base(facts);
      if (!b) return null;
      const f: ExtractedFlight = { ...b, fare_class: FARES[text(facts.querySelector(".fare-name")).toLowerCase()] ?? "economy_light", displayed_price_minor: parseEuro(text(facts.querySelector(".fare-price"))) };
      return { kind: manage ? "manage" : "confirmation", flights: [f], travellers: paxOf(url, facts) };
    }
    const detail = doc.querySelector(".sk-flight-detail");
    if (detail) {
      const b = base(detail);
      if (!b) return null;
      const flights = [...doc.querySelectorAll(".sk-fare")]
        .map((el) => ({ ...b, fare_class: FARES[text(el.querySelector(".sk-fare-name")).toLowerCase()] ?? "", displayed_price_minor: parseEuro(text(el.querySelector(".sk-fare-price"))) }))
        .filter((f) => f.fare_class && f.displayed_price_minor !== undefined);
      return { kind: "details", flights, travellers: paxOf(url) };
    }
    const cards = [...doc.querySelectorAll(".sk-flight")];
    if (!cards.length) return null;
    const flights = cards
      .map((c) => {
        const b = base(c);
        return b ? { ...b, fare_class: "economy_light", displayed_price_minor: parseEuro(text(c.querySelector(".sk-price"))) } : null;
      })
      .filter(Boolean) as ExtractedFlight[];
    return { kind: "search", flights, travellers: paxOf(url) } as PageExtraction;
  },
};
