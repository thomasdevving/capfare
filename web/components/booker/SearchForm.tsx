"use client";
import { useState } from "react";
import { AIRPORTS } from "@capfare/shared";

export default function SearchForm({ from = "AMS", to = "BCN", date = "2027-06-14", pax = 1 }: { from?: string; to?: string; date?: string; pax?: number }) {
  const [f, setF] = useState({ from, to, date, pax: String(pax) });
  return (
    <form className="sk-search" action="/booker/results" method="get" role="search" aria-label="Search flights">
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
        <input type="date" name="date" value={f.date} min="2026-11-10" onChange={(e) => setF({ ...f, date: e.target.value })} required />
      </label>
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
