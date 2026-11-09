"use client";
import { useEffect, useState } from "react";
import type { Policy } from "@capfare/shared";
import { gasless } from "@/lib/wallet";
import { eur } from "@/lib/format";
import BookingProof, { type ProofResult } from "./BookingProof";
import { errText, getJson, Msg, SignInFirst, useSession } from "./ui";

export default function ClaimClient({ id, registry, demo }: { id: number; registry: string; demo: boolean }) {
  const s = useSession();
  const [p, setP] = useState<Policy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ payout: number; index?: number; lowest?: number; paid: number; held: boolean; sent: boolean } | null>(null);

  const load = () => getJson<Policy | null>(`/api/policies?id=${id}`).then(setP).catch((e) => setErr(errText(e)));
  useEffect(() => {
    load();
  }, [id]);

  if (s === undefined) return null;
  if (s === null) return <SignInFirst />;
  if (!p) return err ? <Msg kind="error">{err}</Msg> : <p>Loading…</p>;

  const method = p.product === "cap" && p.state === "active" ? "claim_cap" : p.product === "drop" && p.state === "active" ? "settle_drop" : p.state === "claimed" && p.final_check_at ? "finalize_claim" : null;

  async function onVerified(r: ProofResult) {
    if (!method || !p) return;
    setBusy(true);
    setErr(null);
    const a = r.attestation.attestation;
    setSteps([`Booking verified: paid ${eur(a.paid_price_minor)}, ${a.refundable.replace("_", "-")} ticket. No personal data left the checker.`]);
    try {
      const res = await gasless(registry, method, { policy_id: p.id, attestation: r.attestation });
      const ev = res.events ?? [];
      const lines: string[] = [];
      let payout = -1, index: number | undefined, lowest: number | undefined, held = false, sent = false;
      for (const e of ev) {
        const d = e.data as Record<string, number | string>;
        if (e.event === "claim_verified") { payout = Number(d.payout_minor); index = Number(d.index_minor); }
        if (e.event === "drop_settled") { payout = Number(d.payout_minor); lowest = Number(d.lowest_minor); }
        if (e.event === "payout_held_for_final_check") held = true;
        if (e.event === "payout_sent" || (e.event === "policy_resolved" && String(d.state) === "paid_out")) sent = true;
        if (e.event === "claim_verified") lines.push(`Airline price at booking: ${eur(Number(d.index_minor))}. Payout: ${eur(Number(d.payout_minor))}.`);
        if (e.event === "drop_settled") lines.push(`Lowest price in your window: ${eur(Number(d.lowest_minor))}. Payout: ${eur(Number(d.payout_minor))}.`);
        if (e.event === "payout_held_for_final_check") lines.push("Refundable ticket: the payout is held until a final check one day before departure.");
        if (e.event === "payout_sent") lines.push("Paid to your account.");
        if (e.event === "payout_failed") lines.push("The transfer failed; you can retry from your policies page.");
        if (e.event === "policy_resolved") lines.push(`Policy closed: ${String(d.state).replace("_", " ")}.`);
      }
      setSteps((x) => [...x, ...(lines.length ? lines : ["Submitted."])]);
      if (payout >= 0) setResult({ payout, index, lowest, paid: a.paid_price_minor, held, sent });
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p>
        {p.product === "cap" ? "Price Cap" : "Drop Guarantee"} #{p.id} for {p.flight_key.flight_number} {p.flight_key.origin}→{p.flight_key.destination} on {p.flight_key.departure_date}.
        {p.product === "cap" ? ` Your cap: ${eur(p.strike_minor)}.` : ` You paid: ${eur(p.strike_minor)}.`}
      </p>
      {result ? (
        <section className="card claim-result" aria-live="polite">
          <p className="small muted">{result.sent ? "Paid to your account" : result.held ? "Approved, paid after the final check" : "Approved"}</p>
          <p className="big num">{eur(result.payout)}</p>
          <table className="data" style={{ maxWidth: 420 }}>
            <tbody>
              {result.index !== undefined ? <tr><th>Airline price when you booked</th><td className="r num">{eur(result.index)}</td></tr> : null}
              <tr><th>You paid</th><td className="r num">{eur(result.paid)}</td></tr>
              {result.lowest !== undefined ? <tr><th>Lowest price in your window</th><td className="r num">{eur(result.lowest)}</td></tr> : null}
              {p.product === "cap" ? <tr><th>Your cap</th><td className="r num">−{eur(p.strike_minor)}</td></tr> : null}
              <tr><th>Deductible</th><td className="r num">−{eur(p.deductible_minor)}</td></tr>
              <tr><th>Payout</th><td className="r num"><strong>{eur(result.payout)}</strong></td></tr>
            </tbody>
          </table>
        </section>
      ) : null}
      {result ? null : method ? (
        <>
          <p className="small muted">
            {method === "claim_cap"
              ? "Upload the confirmation of the booking you made while your cap was active."
              : method === "settle_drop"
                ? "Show that your booking is still active at the end of the window. Use your booking code and last name, or upload the confirmation again."
                : "Show that your booking is still active before departure."}
          </p>
          <BookingProof
            flightKey={p.flight_key}
            demo={demo}
            onVerified={onVerified}
            defaultPaid={p.product === "cap" ? 25500 : p.strike_minor}
            liveOnly={method === "finalize_claim" || (method === "settle_drop" && p.refundable !== "non_refundable")}
          />
        </>
      ) : (
        <Msg kind="info">Nothing to do for this policy right now ({p.state.replace("_", " ")}).</Msg>
      )}
      {busy ? <Msg kind="info">Submitting your claim…</Msg> : null}
      {steps.length ? (
        <ol className="card small">
          {steps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      ) : null}
      {err ? <Msg kind="error">{err}</Msg> : null}
      <p><a href="/policies">Back to your policies</a></p>
    </div>
  );
}
