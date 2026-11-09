"use client";
import { useCallback, useEffect, useState } from "react";
import type { Policy, SnapshotRecord } from "@capfare/shared";
import { gasless } from "@/lib/wallet";
import { dateTime, duration, eur, usdc } from "@/lib/format";
import { errText, getJson, Msg, postJson, SignInFirst, useSession } from "./ui";

interface Data {
  policies: Policy[];
  credit: string;
  wallet: string;
  snapshots: Record<string, SnapshotRecord | null>;
  now: number;
}

const STATE: Record<string, string> = {
  funding: "Being set up",
  active: "Active",
  claimed: "Claim approved, payout pending",
  paid_out: "Paid out",
  expired: "Expired",
  refunded: "Premium refunded",
  voided: "Voided",
};

export default function PoliciesClient({ registry, demo }: { registry: string; demo: boolean }) {
  const s = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!s) return;
    getJson<Data>(`/api/policies?account=${s.accountId}`).then(setD).catch((e) => setErr(errText(e)));
  }, [s]);
  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  if (s === undefined) return null;
  if (s === null) return <SignInFirst />;

  async function act(label: string, f: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      await f();
      setMsg("Done.");
      load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p>
        Credit: <strong className="num">{d ? usdc(d.credit) : "…"} tUSDC</strong> · Wallet: <strong className="num">{d ? usdc(d.wallet) : "…"} tUSDC</strong> · <a href="/credit">Manage credit</a>
      </p>
      {err ? <Msg kind="error">{err}</Msg> : null}
      {msg ? <Msg kind="ok">{msg}</Msg> : null}
      {d && d.policies.length === 0 ? (
        <Msg kind="info">
          No policies yet. <a href="/quote">Check a flight</a> to lock a price.
        </Msg>
      ) : null}
      {d?.policies.map((p) => {
        const snap = d.snapshots[p.flight_key_hash];
        const now = d.now;
        const grace = 3 * 86400;
        return (
          <article key={p.id} className="card" aria-labelledby={`p${p.id}`}>
            <h2 id={`p${p.id}`} style={{ fontSize: "var(--s4)" }}>
              {p.product === "cap" ? "Price Cap" : "Drop Guarantee"} #{p.id}: {p.flight_key.flight_number} {p.flight_key.origin}→{p.flight_key.destination}, {p.flight_key.departure_date}
            </h2>
            <p>
              <span className="tag">{STATE[p.state]}{p.busy ? " (processing)" : ""}</span>
            </p>
            <table className="data" style={{ maxWidth: 560 }}>
              <tbody>
                <tr><th>{p.product === "cap" ? "Your cap" : "You paid"}</th><td className="r num">{eur(p.strike_minor)}</td></tr>
                <tr><th>Current airline price</th><td className="r num">{snap ? `${eur(snap.price_minor)}${snap.available ? "" : " (sold out)"}` : "—"}</td></tr>
                <tr><th>Premium</th><td className="r num">{eur(p.premium_minor)}</td></tr>
                <tr><th>Deductible / max payout</th><td className="r num">{eur(p.deductible_minor)} / {eur(p.max_payout_minor)}</td></tr>
                {p.product === "cap" && p.state === "active" ? (
                  <tr><th>Starts</th><td className="r">{now < p.active_from ? `in ${duration(p.active_from - now)}` : `started ${dateTime(p.active_from)}`}</td></tr>
                ) : null}
                {p.state === "active" ? <tr><th>Ends</th><td className="r">{now < p.expires_at ? `in ${duration(p.expires_at - now)}` : `ended ${dateTime(p.expires_at)}`}</td></tr> : null}
                {p.payout_minor !== null ? <tr><th>Payout</th><td className="r num"><strong>{eur(p.payout_minor)}</strong></td></tr> : null}
                {p.final_check_at ? <tr><th>Final booking check</th><td className="r">{dateTime(p.final_check_at)}</td></tr> : null}
              </tbody>
            </table>
            {p.note ? <p className="small muted">{p.note}</p> : null}
            <div className="btn-row" style={{ marginTop: 12 }}>
              {p.product === "cap" && p.state === "active" && now >= p.active_from ? <a className="btn btn-primary" href={`/claim/${p.id}`}>I booked: claim</a> : null}
              {p.product === "drop" && p.state === "active" && now >= p.expires_at ? <a className="btn btn-primary" href={`/claim/${p.id}`}>Window ended: settle</a> : null}
              {p.state === "claimed" && p.final_check_at && now >= p.final_check_at ? <a className="btn btn-primary" href={`/claim/${p.id}`}>Final booking check</a> : null}
              {p.state === "claimed" && !p.final_check_at && !p.busy ? (
                <button className="btn" disabled={!!busy} onClick={() => act("retry", () => gasless(registry, "retry_payout", { policy_id: p.id }))}>Retry payout</button>
              ) : null}
              {p.product === "cap" && p.state === "active" && snap && !snap.available ? (
                <button className="btn" disabled={!!busy} onClick={() => act("refund", () => gasless(registry, "refund_sold_out", { policy_id: p.id }))}>Fare sold out: refund premium</button>
              ) : null}
              {p.state === "active" && now > p.expires_at + grace ? (
                <button className="btn" disabled={!!busy} onClick={() => act("expire", () => gasless(registry, "expire", { policy_id: p.id }))}>Close expired policy</button>
              ) : null}
              {demo && p.state === "active" ? (
                <button className="btn" disabled={!!busy} onClick={() => act("advance", () => postJson("/api/demo/advance", { flight_key: p.flight_key }))}>Demo: next scripted price</button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
