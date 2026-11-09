import { demoSite } from "./demo-site.ts";
import type { SiteAdapter } from "./types.ts";

/** Only adapters with working, fixture-tested extraction are listed. */
export const ADAPTERS: SiteAdapter[] = [demoSite];

export function adapterFor(url: URL): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}
export * from "./types.ts";
