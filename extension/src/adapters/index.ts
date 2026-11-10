import { genericSite } from "./generic.ts";
import { skylineSite } from "./skyline.ts";
import type { PageExtraction, SiteAdapter } from "./types.ts";

/** Site-specific adapters, tried first. Only adapters with fixture-tested extraction are listed. */
export const ADAPTERS: SiteAdapter[] = [skylineSite];

export function adapterFor(url: URL): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}

/** The flight(s) on any page: a site adapter if one knows the site, otherwise the generic reader. */
export function extractPage(doc: Document, url: URL): { adapter: SiteAdapter; page: PageExtraction } | null {
  const specific = adapterFor(url);
  const fromSpecific = specific?.extract(doc, url);
  if (specific && fromSpecific && (fromSpecific.flights.length || fromSpecific.route)) return { adapter: specific, page: fromSpecific };
  const page = genericSite.extract(doc, url);
  return page && (page.flights.length || page.route) ? { adapter: genericSite, page } : null;
}

export { genericSite, extractGeneric } from "./generic.ts";
export * from "./types.ts";
