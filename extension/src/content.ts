import { adapterFor, type ExtractedFlight } from "./adapters/index.ts";
import { renderOverlay, renderVerifyOverlay, type QuoteView } from "./overlay.ts";

function ask<T>(msg: unknown): Promise<T> {
  return new Promise((res) => chrome.runtime.sendMessage(msg, res));
}

async function run() {
  const url = new URL(location.href);
  const adapter = adapterFor(url);
  if (!adapter) return;
  const page = adapter.extract(document, url);
  if (!page || !page.flights.length) return;
  if (page.kind === "manage") {
    const { url: app } = await ask<{ url: string }>({ type: "app-url" });
    document.documentElement.appendChild(renderVerifyOverlay(app, location.href));
    return;
  }
  // Search pages: the cheapest fare; details/confirmation: the selected one.
  const f: ExtractedFlight = page.flights.slice().sort((a, b) => (a.displayed_price_minor ?? 1e12) - (b.displayed_price_minor ?? 1e12))[0];
  const product = page.kind === "confirmation" ? "drop" : "cap";
  const { url: app } = await ask<{ url: string }>({ type: "app-url" });
  const r = await ask<{ ok: boolean; data: QuoteView & { error?: string } }>({ type: "quote", flight: f, product });
  if (!r?.ok) return; // no price source for this flight: stay silent
  const q = new URLSearchParams({
    fn: f.flight_number,
    date: f.departure_date,
    from: f.origin,
    to: f.destination,
    fare: f.fare_class,
    product,
    ...(f.displayed_price_minor ? { hint: String(f.displayed_price_minor) } : {}),
  });
  const view = product === "drop" ? { ...r.data, price_minor: f.displayed_price_minor ?? r.data.price_minor } : r.data;
  document.documentElement.appendChild(renderOverlay(product, view, app, `${app}/quote?${q}`));
}

run();
