import { NextResponse, type NextRequest } from "next/server";

/**
 * One app, two public addresses: CapFare at SITE_URL and the Skyline Travel demo booking site at
 * SKYLINE_URL, on its own domain, so the extension is seen working on a site that isn't CapFare's.
 *
 * * On the Skyline address: "/" opens the booking site; its pages, its API and static files are
 *   served; anything else (a CapFare page) redirects to the CapFare address.
 * * On the CapFare address: /booker pages redirect to the Skyline address.
 * * Any other host (localhost, where the booking checker fetches pages inside the container) is
 *   left alone, and nothing changes when SKYLINE_URL is not set.
 */
const SKYLINE_OWN = /^\/(booker|api\/booker)(\/|$)/;
const SHARED = /^\/([^/]+\.[a-z0-9]+|opengraph-image|twitter-image|images\/.*|how\/.*)$/i;

export function proxy(req: NextRequest) {
  const sky = process.env.SKYLINE_URL;
  const site = process.env.SITE_URL;
  if (!sky || !site) return NextResponse.next();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const { pathname, search } = req.nextUrl;
  if (host === new URL(sky).host) {
    if (pathname === "/") return NextResponse.redirect(new URL("/booker", sky), 307);
    if (!SKYLINE_OWN.test(pathname) && !SHARED.test(pathname)) return NextResponse.redirect(new URL(pathname + search, site), 307);
  } else if (host === new URL(site).host && /^\/booker(\/|$)/.test(pathname)) {
    return NextResponse.redirect(new URL(pathname + search, sky), 308);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
