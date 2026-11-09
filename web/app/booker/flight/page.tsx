import Link from "next/link";
import { BookerShell, dur, eur, longDate } from "@/components/booker/Shell";
import { findFlight, pricesFor } from "@/lib/booker/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — choose your fare", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  const pax = Math.min(4, Math.max(1, Number(q.pax ?? 1)));
  const f = findFlight(q.fn ?? "", q.from ?? "", q.to ?? "", q.date ?? "");
  if (!f) return <BookerShell><div className="sk-wrap sk-section"><div className="sk-err">This flight is no longer available.</div></div></BookerShell>;
  const live = await pricesFor(f);
  const base = `fn=${f.flight_number}&from=${f.origin}&to=${f.destination}&date=${f.departure_date}&pax=${pax}`;
  return (
    <BookerShell>
      <div className="sk-wrap sk-section">
        <p><Link href={`/booker/results?from=${f.origin}&to=${f.destination}&date=${f.departure_date}&pax=${pax}`}>← Back to results</Link></p>
        <article className="sk-card sk-flight-detail">
          <h1 style={{ fontSize: 24 }}>Choose your fare</h1>
          <p style={{ margin: 0 }}>
            <strong className="sk-fn">{f.flight_number}</strong> · {f.airlineName} · <span className="sk-route">{f.origin} → {f.destination}</span> ·{" "}
            <time dateTime={`${f.departure_date}T${f.dep}`}>{longDate(f.departure_date)}</time>, {f.dep}–{f.arr} ({dur(f.durationMin)}, direct)
          </p>
        </article>
        <div className="sk-fares" style={{ marginTop: 14 }}>
          {f.fares.map((fare, i) => {
            const l = live[fare.id];
            return (
              <div key={fare.id} className={`sk-fare ${i === 1 ? "pop" : ""}`}>
                <span className="sk-fare-name">{fare.name}</span>
                {l.available ? <span className="sk-fare-price">{eur(l.price)}</span> : <span className="sk-fare-price" style={{ color: "#a32116" }}>Sold out</span>}
                <span style={{ color: "#5b6678", fontSize: 13 }}>per person{pax > 1 ? `, ${eur(l.price * pax)} total` : ""}</span>
                <ul>
                  <li>Personal item and cabin bag</li>
                  <li>{fare.bag}</li>
                  <li>{fare.changeable ? "Changes allowed" : "No changes"}</li>
                  <li>{fare.refundable ? "Refundable" : "Non-refundable"}</li>
                </ul>
                {l.available ? <a className="sk-btn" href={`/booker/checkout?${base}&fare=${fare.id}`}>Select</a> : null}
              </div>
            );
          })}
        </div>
      </div>
    </BookerShell>
  );
}
