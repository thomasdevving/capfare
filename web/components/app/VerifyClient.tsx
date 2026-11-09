"use client";
/**
 * Landing point of "Verify with CapFare" (extension) and of pasted booking-page links: runs
 * the live check in the enclave, then offers what the verified booking can be used for.
 */
import { useEffect, useState } from "react";
import { flightKeyHash, sealJson, type Policy, type SignedBookingAttestation, type FlightKey } from "@capfare/shared";
import { gasless, passengerSalt } from "@/lib/wallet";
import { eur, dateTime } from "@/lib/format";
import { errText, getJson, Msg, postJson, SignInFirst, useSession } from "./ui";

interface Result {
  attestation: SignedBookingAttestation;
  flight_key: FlightKey;
}

export default function VerifyClient({ registry }: { registry: string }) {
  const s = useSession();
  const [url, setUrl] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    const h = new URLSearchParams(location.hash.slice(1)).get("u");
    if (h) setUrl(h);
  }, []);

  async function verify() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const enclave = await getJson<{ box_public_key: string }>("/api/verifier");
      const sealed = await sealJson({ url: url.trim(), salt: await passengerSalt() }, enclave.box_public_key);
      const r = await postJson<Result>("/api/verify-page", { sealed });
      setRes(r);
      const mine = await getJson<{ policies: Policy[] }>(`/api/policies?account=${s!.accountId}`);
      const h = flightKeyHash(r.flight_key);
      setPolicies(mine.policies.filter((p) => p.flight_key_hash === h));
      history.replaceState(null, "", location.pathname); // drop the link from the address bar
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(label: string, method: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const r = await gasless(registry, method, args);
      const ev = (r.events ?? []).map((e) => e.event);
      setOk(`${label}: done (${ev.filter((e) => /verified|settled|resolved|held|purchased|active/.test(e)).join(", ") || "submitted"}). See your policies.`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (s === undefined) return null;
  if (s === null) return <SignInFirst />;
  const a = res?.attestation.attestation;
  const now = Math.floor(Date.now() / 1000);

  return (
    <div>
      <div className="card">
        <label htmlFor="u">Booking page link</label>
        <input id="u" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/booker/manage?…" autoComplete="off" />
        <p className="hint">Our checker loads this page directly from the booking site, inside the secure enclave, and reads the booking as it is right now. Only flight, fare, price, status and a passenger fingerprint come back.</p>
        <button className="btn btn-primary" onClick={verify} disabled={busy || !url}>{busy && !res ? "Checking the booking site…" : "Verify booking"}</button>
      </div>
      {err ? <Msg kind="error">{err}</Msg> : null}
      {a && res ? (
        <section className="card">
          <h2 style={{ fontSize: "var(--s4)" }}>
            {a.status === "active" ? "Booking verified" : a.status === "cancelled" ? "This booking is cancelled" : "Booking status unknown"}
          </h2>
          <table className="data" style={{ maxWidth: 520 }}>
            <tbody>
              <tr><th>Flight</th><td>{res.flight_key.flight_number} {res.flight_key.origin}→{res.flight_key.destination}, {res.flight_key.departure_date}</td></tr>
              <tr><th>Fare</th><td>{res.flight_key.fare_class.replace("_", " ")}, {a.refundable.replace("_", "-")}</td></tr>
              <tr><th>Paid per passenger</th><td className="num">{eur(a.paid_price_minor)}</td></tr>
              <tr><th>Booked</th><td>{dateTime(a.booked_at)}</td></tr>
              <tr><th>Checked</th><td>{dateTime(a.verified_at)}, live from the booking site</td></tr>
            </tbody>
          </table>
          <div className="btn-row" style={{ marginTop: 14 }}>
            {policies.map((p) => {
              if (p.product === "cap" && p.state === "active" && now >= p.active_from)
                return <button key={p.id} className="btn btn-primary" disabled={busy} onClick={() => act(`Claim #${p.id}`, "claim_cap", { policy_id: p.id, attestation: res.attestation })}>Claim Price Cap #{p.id}</button>;
              if (p.state === "claimed" && p.final_check_at && now >= p.final_check_at)
                return <button key={p.id} className="btn btn-primary" disabled={busy} onClick={() => act(`Final check #${p.id}`, "finalize_claim", { policy_id: p.id, attestation: res.attestation })}>Final check for #{p.id}</button>;
              if (p.product === "drop" && p.state === "active" && now >= p.expires_at)
                return <button key={p.id} className="btn btn-primary" disabled={busy} onClick={() => act(`Settle #${p.id}`, "settle_drop", { policy_id: p.id, attestation: res.attestation })}>Settle Drop Guarantee #{p.id}</button>;
              return null;
            })}
            {a.status === "active" && now - a.booked_at < 86_400 && !policies.some((p) => p.product === "drop") ? (
              <a className="btn" href={`/quote?product=drop&fn=${res.flight_key.flight_number}&date=${res.flight_key.departure_date}&from=${res.flight_key.origin}&to=${res.flight_key.destination}&fare=${res.flight_key.fare_class}`}>Add a Drop Guarantee</a>
            ) : null}
          </div>
          {!policies.length ? <p className="small muted" style={{ marginTop: 10 }}>You have no CapFare policy on this flight.</p> : null}
        </section>
      ) : null}
      {ok ? <Msg kind="ok">{ok} <a href="/policies">Open policies</a></Msg> : null}
    </div>
  );
}
