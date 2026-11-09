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
}

const eur = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
function delay(s: number) {
  if (s < 120) return `${s} seconds`;
  if (s < 7200) return `${Math.round(s / 60)} minutes`;
  return `${Math.round(s / 3600)} hours`;
}

const CSS = `
:host { all: initial; }
.box { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 352px; max-width: calc(100vw - 40px);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
  background: linear-gradient(160deg, rgba(42, 40, 99, 0.86), rgba(30, 28, 72, 0.9));
  border: 1px solid rgba(255,255,255,.22); border-radius: 20px; overflow: hidden;
  backdrop-filter: blur(16px) saturate(1.15); -webkit-backdrop-filter: blur(16px) saturate(1.15);
  box-shadow: 0 20px 50px rgba(10, 8, 36, .38); }
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 4px; font-weight: 700; font-size: 17px; letter-spacing: -.01em; }
.brand { display: inline-flex; align-items: center; gap: 8px; }
.close { background: rgba(255,255,255,.1); border: 0; color: #fff; font-size: 16px; cursor: pointer; line-height: 1; width: 28px; height: 28px; border-radius: 999px; }
.body { padding: 6px 16px 16px; }
.lead { font-size: 16px; font-weight: 700; margin: 0 0 10px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 12px; font-size: 13px; padding: 10px 12px; background: rgba(255,255,255,.07); border-radius: 12px; }
dt { color: #cfc9ee; } dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.cta { display: block; text-align: center; background: #ffd100; color: #14132e; font-weight: 700; text-decoration: none; padding: 12px; border-radius: 12px; }
.cta:hover { background: #ffdc3d; }
.cta:focus-visible, .close:focus-visible, a:focus-visible { outline: 3px solid #ffd100; outline-offset: 2px; }
.small { font-size: 12px; color: #cfc9ee; margin: 10px 0 0; }
.small a { color: #e6dfff; }
`;

export function renderOverlay(kind: "cap" | "drop", q: QuoteView, appUrl: string, href: string): HTMLElement {
  const host = document.createElement("capfare-overlay");
  const root = host.attachShadow({ mode: "closed" });
  const lead =
    kind === "cap"
      ? `Not ready to book? Lock a max price of ${eur(q.cap_minor!)} for ${eur(q.premium_minor)}, valid ${q.validity_days} days.`
      : `Booked at ${eur(q.price_minor)}. Add a Drop Guarantee for ${eur(q.premium_minor)}.`;
  root.innerHTML = `<style>${CSS}</style>
  <section class="box" role="dialog" aria-label="CapFare price protection">
    <div class="head"><span class="brand"><svg width="26" height="20" viewBox="0 0 104 80" aria-hidden="true"><g fill="#FFD100" stroke="#FFD100" stroke-width="9" stroke-linejoin="round"><path d="M9 74 L41 16 L60 16 L28 74 Z"/><path d="M45 74 L67 34 L86 34 L64 74 Z"/></g><g transform="translate(70 -2) rotate(45 15 15) scale(1.25)" fill="#FFD100"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></g></svg>CapFare</span><button class="close" aria-label="Close">×</button></div>
    <div class="body">
      <p class="lead"></p>
      <dl>
        <dt>Flight</dt><dd class="f"></dd>
        <dt>Airline price now</dt><dd class="p"></dd>
        <dt>Deductible</dt><dd class="d"></dd>
        <dt>Max payout</dt><dd class="m"></dd>
        ${kind === "cap" ? `<dt>Starts after</dt><dd class="a"></dd>` : ""}
      </dl>
      <a class="cta" target="_blank" rel="noopener"></a>
      <p class="small">Premium from the public on-chain formula (${q.network}). <a class="t" target="_blank" rel="noopener">How we price</a>${q.demo_price ? ". Demo price source." : "."}</p>
    </div>
  </section>`;
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  $(".lead").textContent = lead;
  $(".f").textContent = q.flight_label;
  $(".p").textContent = eur(q.price_minor);
  $(".d").textContent = eur(q.deductible_minor);
  $(".m").textContent = eur(q.max_payout_minor);
  if (kind === "cap") $(".a").textContent = delay(q.activation_delay_secs);
  const cta = $(".cta") as HTMLAnchorElement;
  cta.textContent = kind === "cap" ? "Lock this price" : "Add Drop Guarantee";
  cta.href = href;
  ($(".t") as HTMLAnchorElement).href = `${appUrl}/transparency`;
  $(".close").addEventListener("click", () => host.remove());
  return host;
}
