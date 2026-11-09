"use client";
import { useMemo, useState } from "react";
import type { DemoFlight } from "@capfare/shared";
import { dur, eur } from "./Shell";

type Row = DemoFlight & { live: Record<string, { price: number; available: boolean }> };

const SLOTS = [
  { id: "morning", label: "Morning (05:00–11:59)", test: (h: number) => h >= 5 && h < 12 },
  { id: "afternoon", label: "Afternoon (12:00–17:59)", test: (h: number) => h >= 12 && h < 18 },
  { id: "evening", label: "Evening (18:00–23:59)", test: (h: number) => h >= 18 },
];

export default function Results({ flights, pax, query }: { flights: Row[]; pax: number; query: string }) {
  const airlines = [...new Set(flights.map((f) => f.airlineName))].sort();
  const cheapest = (f: Row) => Math.min(...Object.values(f.live).filter((x) => x.available).map((x) => x.price));
  const maxPrice = Math.max(...flights.map(cheapest), 0);
  const [sort, setSort] = useState<"best" | "cheapest" | "fastest">("best");
  const [al, setAl] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [cap, setCap] = useState(maxPrice);

  const shown = useMemo(() => {
    let r = flights.filter((f) => (!al.length || al.includes(f.airlineName)) && (!slots.length || SLOTS.some((s) => slots.includes(s.id) && s.test(Number(f.dep.slice(0, 2))))) && cheapest(f) <= cap);
    if (sort === "cheapest") r = [...r].sort((a, b) => cheapest(a) - cheapest(b));
    else if (sort === "fastest") r = [...r].sort((a, b) => a.durationMin - b.durationMin);
    else r = [...r].sort((a, b) => cheapest(a) / 100 + a.durationMin * 0.4 - (cheapest(b) / 100 + b.durationMin * 0.4));
    return r;
  }, [flights, al, slots, cap, sort]);

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="sk-layout">
      <aside className="sk-card sk-filters" aria-label="Filters">
        <h2 style={{ fontSize: 17 }}>Filter by</h2>
        <h3>Airlines</h3>
        {airlines.map((a) => (
          <label key={a}>
            <input type="checkbox" checked={al.includes(a)} onChange={() => setAl(toggle(al, a))} /> {a}
          </label>
        ))}
        <h3>Departure time</h3>
        {SLOTS.map((s) => (
          <label key={s.id}>
            <input type="checkbox" checked={slots.includes(s.id)} onChange={() => setSlots(toggle(slots, s.id))} /> {s.label}
          </label>
        ))}
        <h3>Max price per person: {eur(cap)}</h3>
        <input type="range" min={0} max={maxPrice} step={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} aria-label="Maximum price" />
      </aside>
      <div>
        <div className="sk-sort" role="group" aria-label="Sort">
          {(["best", "cheapest", "fastest"] as const).map((s) => (
            <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)}>
              {s === "best" ? "Best" : s === "cheapest" ? "Cheapest" : "Fastest"}
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 10px", color: "#5b6678" }}>{shown.length} flight{shown.length === 1 ? "" : "s"}, direct only</p>
        {shown.map((f) => (
          <article key={f.flight_number} className="sk-flight">
            <div>
              <div className="times">
                <div>
                  <div className="t">{f.dep}</div>
                  <div className="ap">{f.origin}</div>
                </div>
                <div className="line">{dur(f.durationMin)} · Direct</div>
                <div>
                  <div className="t">{f.arr}</div>
                  <div className="ap">{f.destination}</div>
                </div>
              </div>
              <div className="meta">
                <span className="sk-airline">{f.airlineName}</span> · <span className="sk-fn">{f.flight_number}</span> · <span className="sk-route">{f.origin} → {f.destination}</span> ·{" "}
                <time dateTime={`${f.departure_date}T${f.dep}`}>{f.departure_date}</time>
              </div>
            </div>
            <div className="price">
              <small>Economy Light from</small>
              <span className="sk-price">{eur(f.live.economy_light?.price ?? cheapest(f))}</span>
              <small>{pax > 1 ? `${eur(cheapest(f) * pax)} for ${pax} travellers` : "per person, incl. taxes"}</small>
              <a className="sk-btn" style={{ marginTop: 8 }} href={`/booker/flight?fn=${f.flight_number}&${query}`}>See fares</a>
            </div>
          </article>
        ))}
        {!shown.length ? <div className="sk-card">No flights match these filters.</div> : null}
      </div>
    </div>
  );
}
