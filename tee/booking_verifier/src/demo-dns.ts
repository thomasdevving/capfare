/**
 * Demo DNS. ".example" domains have no public DNS, so in demo deployments the DKIM key of the
 * Skyline Travel demo site is fetched from the site itself (GET /api/booker/dkim). Only that one
 * selector/domain is resolved this way; everything else uses real DNS (or the fixture resolver).
 */
import { SKYLINE_DOMAIN } from "./airlines/skyline.ts";

type Resolver = (name: string, rr: string) => Promise<unknown>;

export function skylineResolver(dkimUrl: string, fallback: Resolver): Resolver {
  let cache: { at: number; record: string } | null = null;
  return async (name, rr) => {
    if (rr === "TXT" && name === `skyline._domainkey.${SKYLINE_DOMAIN}`) {
      if (!cache || Date.now() - cache.at > 60_000) {
        const r = await fetch(dkimUrl);
        if (!r.ok) throw Object.assign(new Error("demo DNS unavailable"), { code: "ESERVFAIL" });
        cache = { at: Date.now(), record: ((await r.json()) as { record: string }).record };
      }
      return [[cache.record]];
    }
    return fallback(name, rr);
  };
}
