"use client";
import { useState } from "react";

export default function Trips() {
  const [ref, setRef] = useState("");
  const [last, setLast] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="sk-card sk-form" style={{ maxWidth: 480 }} onSubmit={async (e) => {
      e.preventDefault();
      setErr(null);
      const r = await fetch("/api/booker/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref, last }) });
      const j = await r.json();
      if (!r.ok) return setErr(j.error);
      location.href = `/booker/manage?ref=${j.ref}&t=${j.token}`;
    }}>
      <h1 style={{ fontSize: 24 }}>Find your booking</h1>
      <label htmlFor="ref">Booking code</label>
      <input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} required autoComplete="off" />
      <label htmlFor="last">Last name</label>
      <input id="last" value={last} onChange={(e) => setLast(e.target.value)} required autoComplete="family-name" />
      {err ? <div className="sk-err" style={{ marginTop: 10 }} role="alert">{err}</div> : null}
      <button className="sk-btn" style={{ marginTop: 14 }}>Find booking</button>
    </form>
  );
}
