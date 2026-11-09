/**
 * Airline-website adapters (fetch the airline's own offer page over TLS from inside the
 * enclave, with a headless browser where needed).
 *
 * STATUS: no live adapter is enabled. The airlines we looked at (KLM, Transavia) do not
 * permit automated access to their booking flows in their website terms, and we have no
 * partner API agreement. Following the brief, such adapters are marked demo-only and
 * refuse to run outside demo deployments. A licensed data partnership (airline offer API,
 * or an NDC aggregator) is the path to live prices; see docs/DECISIONS.md.
 */
import type { FlightKey } from "@capfare/shared";
import type { FareObservation, PriceAdapter } from "./types.ts";

export interface AirlineSiteConfig {
  id: string; // e.g. "klm.com"
  airlines: string[]; // IATA codes served
  robotsAllowsAutomation: boolean;
  termsAllowAutomation: boolean;
  notes: string;
}

export const AIRLINE_SITES: AirlineSiteConfig[] = [
  {
    id: "klm.com",
    airlines: ["KL"],
    robotsAllowsAutomation: false,
    termsAllowAutomation: false,
    notes: "Website terms do not allow automated access to booking/offer pages. Demo-only until a data agreement exists.",
  },
  {
    id: "transavia.com",
    airlines: ["HV"],
    robotsAllowsAutomation: false,
    termsAllowAutomation: false,
    notes: "Same as above. Demo-only.",
  },
];

export class AirlineSiteAdapter implements PriceAdapter {
  readonly access: "live" | "demo-only";
  readonly id: string;

  constructor(private cfg: AirlineSiteConfig, private pageFetcher?: (k: FlightKey) => Promise<FareObservation>) {
    this.id = cfg.id;
    this.access = cfg.robotsAllowsAutomation && cfg.termsAllowAutomation ? "live" : "demo-only";
  }

  supports(k: FlightKey): boolean {
    return this.cfg.airlines.includes(k.airline);
  }

  async fetch(k: FlightKey): Promise<FareObservation> {
    if (this.access !== "live" && process.env.CAPFARE_DEPLOYMENT !== "demo" && process.env.CAPFARE_DEPLOYMENT !== "test") {
      throw new Error(`${this.id}: automated access not permitted; adapter disabled (${this.cfg.notes})`);
    }
    if (!this.pageFetcher) throw new Error(`${this.id}: no page fetcher configured`);
    return this.pageFetcher(k);
  }
}

/**
 * Parser for an airline offer page snapshot (used with a headless browser or saved HTML in
 * tests). Looks for a fare card with data attributes or a "fare-class + price" pattern.
 */
export function parseFarePage(html: string, fareLabel: string): { price_minor: number; available: boolean } | null {
  const esc = fareLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const card = new RegExp(`<[^>]*data-fare="${esc}"[^>]*>([\\s\\S]*?)</(?:section|div|li)>`, "i").exec(html);
  if (!card) return null;
  if (/sold out|uitverkocht|not available/i.test(card[1])) return { price_minor: 0, available: false };
  const m = /(?:€|EUR)\s*([0-9]{1,5})(?:[.,]([0-9]{2}))?/.exec(card[1]);
  if (!m) return null;
  return { price_minor: Number(m[1]) * 100 + Number(m[2] ?? 0), available: true };
}
