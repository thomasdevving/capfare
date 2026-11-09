"use client";
import { useState } from "react";
import { AIRPORTS } from "@capfare/shared";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default function SearchForm({ from = "AMS", to = "BCN", date = "2027-06-14", ret = "", pax = 1 }: { from?: string; to?: string; date?: string; ret?: string; pax?: number }) {
  const [f, setF] = useState({ from, to, date, ret: ret || addDays(date, 7), trip: ret ? "return" : "oneway", pax: String(pax) });
  return (
    <form className="sk-search" action="/booker/results" method="get" role="search" aria-label="Search flights">
      <fieldset className="sk-trip" aria-label="Trip type">
        <label><input type="radio" name="trip" value="oneway" checked={f.trip === "oneway"} onChange={() => setF({ ...f, trip: "oneway" })} /> One-way</label>
        <label><input type="radio" name="trip" value="return" checked={f.trip === "return"} onChange={() => setF({ ...f, trip: "return" })} /> Return</label>
      </fieldset>
      <label>
        Leaving from
        <select name="from" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
          {AIRPORTS.map((a) => (
            <option key={a.code} value={a.code}>{a.city} ({a.code})</option>
          ))}
        </select>
      </label>
      <label>
        Going to
        <select name="to" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
          {AIRPORTS.filter((a) => a.code !== f.from).map((a) => (
            <option key={a.code} value={a.code}>{a.city} ({a.code})</option>
          ))}
        </select>
      </label>
      <label>
        Departure
        <input type="date" name="date" value={f.date} min="2026-11-10" onChange={(e) => setF({ ...f, date: e.target.value, ret: f.ret < e.target.value ? addDays(e.target.value, 7) : f.ret })} required />
      </label>
      {f.trip === "return" ? (
        <label>
          Return
          <input type="date" name="ret" value={f.ret} min={f.date} onChange={(e) => setF({ ...f, ret: e.target.value })} required />
        </label>
      ) : null}
      <label>
        Travellers
        <select name="pax" value={f.pax} onChange={(e) => setF({ ...f, pax: e.target.value })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>{n} adult{n > 1 ? "s" : ""}</option>
          ))}
        </select>
      </label>
      <button className="sk-btn" type="submit">Search</button>
    </form>
  );
}
