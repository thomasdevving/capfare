/**
 * Runs on booking pages: the CapFare demo site always; any https site once the user turns on
 * automatic checks, or the current tab when they press "Check this page" in the popup.
 * Reads the flight from the page (site adapter or generic reader), asks the background worker
 * for a quote and shows the overlay. Only the flight key (no URL, no personal data) leaves the page.
 */
import { extractPage, type ExtractedFlight, type PageExtraction, type RouteHint, type SiteAdapter } from "./adapters/index.ts";
import { renderNotice, renderOverlay, renderVerifyOverlay, type QuoteView } from "./overlay.ts";

declare global {
  // eslint-disable-next-line no-var
  var __capfare: { run(manual: boolean): void } | undefined;
  // eslint-disable-next-line no-var
  var __capfareManual: boolean | undefined;
}

type QuoteReply = { ok: boolean; data: QuoteView & { error?: string } };
type Coverage = { flight: ExtractedFlight } | { route: RouteHint & { fare_class: string } };

function ask<T>(msg: unknown): Promise<T> {
  return new Promise((res) => chrome.runtime.sendMessage(msg, res));
}

const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const describe = (c: Coverage) =>
  "flight" in c ? `${c.flight.flight_number} ${c.flight.origin}→${c.flight.destination}, ${dateLabel(c.flight.departure_date)}` : `flights ${c.route.origin}→${c.route.destination} on ${dateLabel(c.route.departure_date)}`;

function quoteLink(app: string, c: Coverage, product: "cap" | "drop", travellers: number): string {
  const r = "flight" in c ? c.flight : c.route;
  const q = new URLSearchParams({
    ...("flight" in c ? { fn: c.flight.flight_number } : { scope: "route" }),
    date: r.departure_date,
    from: r.origin,
    to: r.destination,
    fare: r.fare_class,
    product,
    ...(travellers > 1 ? { pax: String(travellers) } : {}),
    ...("flight" in c && c.flight.displayed_price_minor ? { hint: String(c.flight.displayed_price_minor) } : {}),
  });
  return `${app}/quote?${q}`;
}

/** Search pages: the cheapest priced fare; details and confirmation pages: the flight shown. */
function pick(page: PageExtraction): ExtractedFlight | undefined {
  return page.flights.slice().sort((a, b) => (a.displayed_price_minor ?? 1e12) - (b.displayed_price_minor ?? 1e12))[0];
}

let overlay: HTMLElement | null = null;
let shown = "";
const dismissed = new Set<string>();
let busy = false;
let again = false;

function show(el: HTMLElement, sig: string) {
  overlay?.remove();
  overlay = el;
  shown = sig;
  document.documentElement.appendChild(el);
}

async function run(manual: boolean): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    await check(manual);
  } finally {
    busy = false;
    if (again) {
      again = false;
      void run(false);
    }
  }
}

async function check(manual: boolean) {
  // The user closed the last offer: don't bring the same one back on its own.
  if (overlay && !overlay.isConnected && shown) dismissed.add(shown);
  const url = new URL(location.href);
  const found = extractPage(document, url);
  const { url: app } = await ask<{ url: string }>({ type: "app-url" });
  if (!found) {
    void ask({ type: "seen", state: null });
    if (manual)
      show(
        renderNotice(app, {
          title: "No flight found on this page.",
          body: "CapFare looks for a flight number, the airports and the date. Try the search results, the flight details or your booking page, or enter the flight yourself.",
          cta: "Check a flight in CapFare",
        }),
        "notice",
      );
    return;
  }
  const { adapter, page } = found;
  const travellers = page.travellers ?? 1;
  const f = pick(page);
  const sig = JSON.stringify([page.kind, f?.flight_number, f?.departure_date, f?.fare_class, page.route, travellers]);
  if (!manual && (dismissed.has(sig) || (sig === shown && overlay?.isConnected))) return;

  if (page.kind === "manage") {
    void ask({ type: "seen", state: { label: f ? describe({ flight: f }) : "your booking", offer: "verify" } });
    show(renderVerifyOverlay(app, (adapter as SiteAdapter).liveCheck ? location.href : null), sig);
    return;
  }

  const product = page.kind === "confirmation" ? "drop" : "cap";
  const tryQuote = async (c: Coverage) => {
    const r = await ask<QuoteReply>({ type: "quote", coverage: "flight" in c ? { flight: c.flight } : { route: c.route }, product, travellers });
    return r?.ok ? r : null;
  };
  // The exact flight first; for a Price Cap, fall back to cover on the route and day
  // (comparison sites often show no flight numbers; route cover needs none).
  let cov: Coverage | undefined = f ? { flight: f } : undefined;
  let res = cov ? await tryQuote(cov) : null;
  if (!res && product === "cap") {
    const r = page.route ?? (f ? { origin: f.origin, destination: f.destination, departure_date: f.departure_date } : undefined);
    if (r) {
      const routeCov: Coverage = { route: { ...r, fare_class: f?.fare_class ?? "economy_light" } };
      res = await tryQuote(routeCov);
      if (res) cov = routeCov;
    }
  }
  const seen = cov ?? (page.route ? { route: { ...page.route, fare_class: "economy_light" } } : undefined);
  if (!res || !cov) {
    void ask({ type: "seen", state: seen ? { label: describe(seen), offer: null } : null });
    if (manual && seen)
      show(
        renderNotice(app, {
          title: `Found ${describe(seen)}.`,
          body: "There's no verified price for it yet, so CapFare can't offer cover on it right now. You can still look it up and set an alert.",
          cta: "Open in CapFare",
          href: quoteLink(app, seen, product, travellers),
        }),
        sig,
      );
    return;
  }
  const view: QuoteView = { ...res.data, scope: "route" in cov ? "route" : "flight" };
  if (product === "drop" && f?.displayed_price_minor) view.price_minor = f.displayed_price_minor;
  void ask({ type: "seen", state: { label: describe(cov), offer: product } });
  show(renderOverlay(product, view, app, quoteLink(app, cov, product, travellers)), sig);
}

/** Single-page sites load results after the page: check again when the content settles. */
function watch() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checks = 0;
  let href = location.href;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (++checks > 40) return obs.disconnect();
      if (location.href !== href) {
        href = location.href;
        overlay?.remove();
        shown = "";
      }
      void run(false);
    }, 1200);
  };
  const obs = new MutationObserver(later);
  if (document.body) obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener("popstate", later);
  addEventListener("hashchange", later);
}

if (globalThis.__capfare) {
  globalThis.__capfare.run(globalThis.__capfareManual === true);
} else {
  globalThis.__capfare = { run: (manual) => void run(manual) };
  void run(globalThis.__capfareManual === true);
  watch();
}
globalThis.__capfareManual = false;
