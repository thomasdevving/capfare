/** Non-intrusive overlay rendered in a closed shadow root (page CSS cannot leak in). */
export interface QuoteView {
  flight_label: string;
  price_minor: number;
  cap_minor?: number;
  premium_minor: number;
  deductible_minor: number;
  max_payout_minor: number;
  activation_delay_secs: number;
  validity_days: number;
  demo_price: boolean;
  network: string;
  travellers?: number;
  /** "route": any non-stop flight on the route and day (pages without flight numbers). */
  scope?: "flight" | "route";
}

const eur = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
function delay(s: number) {
  if (s < 120) return `${s} seconds`;
  if (s < 7200) return `${Math.round(s / 60)} minutes`;
  return `${Math.round(s / 3600)} hours`;
}

const MARK = `<svg width="26" height="20" viewBox="0 0 104 80" aria-hidden="true"><g fill="#FFD100" stroke="#FFD100" stroke-width="9" stroke-linejoin="round"><path d="M9 74 L41 16 L60 16 L28 74 Z"/><path d="M45 74 L67 34 L86 34 L64 74 Z"/></g><g transform="translate(70 -2) rotate(45 15 15) scale(1.25)" fill="#FFD100"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></g></svg>`;

/* Navy and yellow, matching the CapFare landing page (web/app/globals.css, .landing). */
const CSS = `
:host { all: initial; }
.box { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 360px; max-width: calc(100vw - 40px);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
  background: linear-gradient(170deg, #0f2c55 0%, #0b2447 46%, #081b36 100%);
  border: 1px solid rgba(211, 227, 249, 0.22); border-radius: 18px; overflow: hidden;
  box-shadow: 0 22px 54px rgba(5, 22, 47, 0.45), 0 2px 0 rgba(255, 209, 0, 0.9) inset; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 6px; }
.brand { display: inline-flex; align-items: center; gap: 8px; font: 700 17px/1 "Outfit", system-ui, sans-serif; letter-spacing: -0.01em; }
.close { background: rgba(211, 227, 249, 0.12); border: 0; color: #fff; font-size: 16px; cursor: pointer; line-height: 1; width: 28px; height: 28px; border-radius: 999px; }
.close:hover { background: rgba(211, 227, 249, 0.22); }
.body { padding: 4px 16px 16px; }
.when { display: inline-block; margin: 0 0 10px; padding: 3px 10px; border-radius: 6px; background: #ffd100; color: #0b2447; font-weight: 650; font-size: 12px; }
.lead { font: 700 17px/1.35 "Outfit", system-ui, sans-serif; margin: 0 0 12px; letter-spacing: -0.005em; }
.lead em { font-style: normal; color: #ffd100; }
.f { margin: -4px 0 10px; font-size: 13px; color: #c7d5e8; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0 0 14px; font-size: 13px; padding: 12px 14px; background: rgba(211, 227, 249, 0.09); border: 1px solid rgba(211, 227, 249, 0.14); border-radius: 12px; }
dt { color: #c7d5e8; white-space: nowrap; } dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.cta { display: block; text-align: center; background: #ffd100; color: #0b2447; font-weight: 700; text-decoration: none; padding: 13px; border-radius: 12px; }
.cta:hover { background: #ffdc3d; }
.cta:focus-visible, .close:focus-visible, a:focus-visible { outline: 3px solid #ffd100; outline-offset: 2px; }
.small { font-size: 12px; color: #c7d5e8; margin: 10px 0 0; }
.small a { color: #e3edfc; }
.watch { display: block; text-align: center; margin: 10px 0 0; color: #e3edfc; font-size: 13px; font-weight: 600; }
.watch:hover { color: #fff; }
`;

export function renderOverlay(kind: "cap" | "drop", q: QuoteView, appUrl: string, href: string): HTMLElement {
  const host = document.createElement("capfare-overlay");
  const root = host.attachShadow({ mode: "closed" });
  const n = q.travellers ?? 1;
  const who = n > 1 ? ` for ${n} travellers` : "";
  // Text only (no page data is ever inserted as HTML): [plain, highlighted, plain].
  const lead: [string, string, string] =
    kind === "cap"
      ? q.scope === "route"
        ? ["Lock a max price of ", eur(q.cap_minor!), ` per person${who} on any non-stop flight on this route that day, for ${eur(q.premium_minor)}, valid ${q.validity_days} days.`]
        : ["Lock a max price of ", eur(q.cap_minor!), ` per person${who} for ${eur(q.premium_minor)}, valid ${q.validity_days} days.`]
      : ["Booked at ", eur(q.price_minor), `${n > 1 ? " per person" : ""}. If the price drops within the week, get the difference${who} for ${eur(q.premium_minor)}.`];
  root.innerHTML = `<style>${CSS}</style>
  <section class="box" role="dialog" aria-label="CapFare price protection">
    <div class="head"><span class="brand">${MARK}CapFare</span><button class="close" aria-label="Close">×</button></div>
    <div class="body">
      <span class="when"></span>
      <p class="lead"><span></span><em></em><span></span></p>
      <p class="f"></p>
      <dl>
        <dt>${q.scope === "route" ? "Cheapest fare now" : "Airline price now"}</dt><dd class="p"></dd>
        <dt>Deductible</dt><dd class="d"></dd>
        <dt>Max payout${n > 1 ? " (all travellers)" : ""}</dt><dd class="m"></dd>
        ${kind === "cap" ? `<dt>Starts after</dt><dd class="a"></dd>` : ""}
      </dl>
      <a class="cta" target="_blank" rel="noopener"></a>
      ${kind === "cap" ? `<a class="watch" target="_blank" rel="noopener">Not ready? Watch the price for free</a>` : ""}
      <p class="small">Premium from the public on-chain formula (${q.network}). <a class="t" target="_blank" rel="noopener">How we price</a>${q.demo_price ? ". Demo price source." : "."}</p>
    </div>
  </section>`;
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  $(".when").textContent = kind === "cap" ? "Not booked yet" : "Just booked";
  const [a, b, c] = Array.from(root.querySelectorAll(".lead > *"));
  a.textContent = lead[0];
  b.textContent = lead[1];
  c.textContent = lead[2];
  $(".f").textContent = q.flight_label;
  $(".p").textContent = eur(q.price_minor);
  $(".d").textContent = eur(q.deductible_minor);
  $(".m").textContent = eur(q.max_payout_minor);
  if (kind === "cap") $(".a").textContent = delay(q.activation_delay_secs);
  const cta = $(".cta") as HTMLAnchorElement;
  cta.textContent = kind === "cap" ? "Lock this price" : "Add Drop Guarantee";
  cta.href = href;
  if (kind === "cap") ($(".watch") as HTMLAnchorElement).href = `${href}&watch=1`;
  ($(".t") as HTMLAnchorElement).href = `${appUrl}/transparency`;
  $(".close").addEventListener("click", () => host.remove());
  return host;
}

/** Manage-booking page. Where CapFare's checker can load the site's booking pages, hand it the
 *  link for a live check (no data is read here); elsewhere, point to the email upload. */
export function renderVerifyOverlay(appUrl: string, pageUrl: string | null): HTMLElement {
  const host = document.createElement("capfare-overlay");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${CSS}</style>
  <section class="box" role="dialog" aria-label="CapFare booking check">
    <div class="head"><span class="brand">${MARK}CapFare</span><button class="close" aria-label="Close">×</button></div>
    <div class="body">
      <span class="when">Booked with CapFare?</span>
      <p class="lead"></p>
      <p class="small" style="margin:0 0 12px"></p>
      <a class="cta" target="_blank" rel="noopener">Verify with CapFare</a>
    </div>
  </section>`;
  const $ = (q: string) => root.querySelector(q) as HTMLElement;
  if (pageUrl) {
    $(".lead").textContent = "Verify this booking straight from the page.";
    $(".small").textContent = "CapFare's checker loads this booking page from the booking site and reads only the flight, fare, price and status. Works for claims and for the final check of refundable tickets.";
    ($(".cta") as HTMLAnchorElement).href = `${appUrl}/verify#u=${encodeURIComponent(pageUrl)}`;
  } else {
    $(".lead").textContent = "Verify this booking with its confirmation email.";
    $(".small").textContent = "Upload the original confirmation email from this booking site. Its digital signature shows it wasn't changed; only the flight, fare and price come back. Live checks straight from the page work on supported sites.";
    ($(".cta") as HTMLAnchorElement).href = `${appUrl}/verify`;
  }
  $(".close").addEventListener("click", () => host.remove());
  return host;
}

/** Manual check ("Check this page") that found nothing to offer: say what was seen and what to do. */
export function renderNotice(appUrl: string, n: { title: string; body: string; cta: string; href?: string }): HTMLElement {
  const host = document.createElement("capfare-overlay");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${CSS}</style>
  <section class="box" role="dialog" aria-label="CapFare">
    <div class="head"><span class="brand">${MARK}CapFare</span><button class="close" aria-label="Close">×</button></div>
    <div class="body">
      <p class="lead"></p>
      <p class="small" style="margin:0 0 12px"></p>
      <a class="cta" target="_blank" rel="noopener"></a>
    </div>
  </section>`;
  const $ = (q: string) => root.querySelector(q) as HTMLElement;
  $(".lead").textContent = n.title;
  $(".small").textContent = n.body;
  $(".cta").textContent = n.cta;
  ($(".cta") as HTMLAnchorElement).href = n.href ?? `${appUrl}/quote`;
  $(".close").addEventListener("click", () => host.remove());
  return host;
}
