"use client";
/**
 * Watched prices (free alerts). Loaded when opened, because reading them is a request signed
 * with your account key: which flights you watch is kept only by the alert service.
 */
import { useState } from "react";
import { signAccountRequest } from "@/lib/wallet";
import { dateTime, eur } from "@/lib/format";
import { errText, Msg, postJson } from "./ui";

interface Watch {
  id: string;
  label: string;
  seats: number;
  baseline_minor: number;
  target_minor?: number;
  price_minor?: number;
  available?: boolean;
  checked_at?: number;
  href: string;
}
interface View {
  push_devices: number;
  email: { verified: boolean } | null;
  watches: Watch[];
}

async function send(payload: Record<string, unknown>): Promise<View> {
  return postJson<View>("/api/notify/settings", await signAccountRequest("notify", payload));
}

function change(w: Watch) {
  if (w.price_minor === undefined) return null;
  const d = w.price_minor - w.baseline_minor;
  if (!d) return <span className="muted">no change</span>;
  const pct = Math.round((Math.abs(d) / w.baseline_minor) * 100);
  return <span className={d > 0 ? "fail" : "pass"}>{d > 0 ? "▲" : "▼"} {eur(Math.abs(d))} ({pct}%)</span>;
}

export default function WatchList() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(label: string, payload: Record<string, unknown>) {
    setBusy(label);
    setErr(null);
    try {
      setView(await send(payload));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <details id="watching" className="card" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && !view && run("load", { action: "get" })}>
      <summary><strong>Watched prices</strong> <span className="small muted">— free alerts when a flight you&apos;re considering gets more expensive or cheaper</span></summary>
      <div style={{ marginTop: 12 }}>
        {busy === "load" ? <p className="small muted">Loading…</p> : null}
        {err ? <Msg kind="error">{err}</Msg> : null}
        {view && !view.watches.length ? (
          <p className="small">Nothing watched yet. On <a href="/quote">Check a flight</a>, get a quote and choose <em>Watch the price</em>; the extension offers it on booking sites too.</p>
        ) : null}
        {view?.watches.length ? (
          <>
            <table className="data">
              <thead>
                <tr><th>Flight</th><th className="r">Started at</th><th className="r">Now</th><th className="r">Change</th><th /></tr>
              </thead>
              <tbody>
                {view.watches.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <a href={w.href}>{w.label}</a>
                      {w.seats > 1 ? <span className="small muted"> · {w.seats} travellers</span> : null}
                      {w.target_minor !== undefined ? <span className="small muted"> · target {eur(w.target_minor)}</span> : null}
                    </td>
                    <td className="r num">{eur(w.baseline_minor)}</td>
                    <td className="r num" title={w.checked_at ? `checked ${dateTime(w.checked_at)}` : undefined}>
                      {w.available === false ? "sold out" : w.price_minor !== undefined ? eur(w.price_minor) : "…"}
                    </td>
                    <td className="r num">{change(w)}</td>
                    <td className="r">
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => run(w.id, { action: "watch_remove", id: w.id })}>Stop</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.push_devices === 0 && !view.email?.verified ? (
              <Msg kind="info">Turn on push or email alerts (Get alerts, above) to hear when these move.</Msg>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
