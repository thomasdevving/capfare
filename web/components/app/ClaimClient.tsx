"use client";
import { useEffect, useState } from "react";
import { coverageLabel, type Coverage, type FlightKey, type Policy, type RouteKey } from "@capfare/shared";
import { gasless, type RelayResult } from "@/lib/wallet";
import { duration, eur } from "@/lib/format";
import { maxPremium, premiumFor, type PremiumQuote } from "@/lib/premium";
import BookingProof, { type ProofResult } from "./BookingProof";
import { errText, getJson, Msg, postJson, SignInFirst, useSession } from "./ui";

interface LegResult {
  policy: Policy;
  payout: number;
  index?: number;
  lowest?: number;
  paid: number;
  seats: number;
  held: boolean;
  sent: boolean;
  proof: ProofResult;
}

interface DropOffer {
  cap: Policy;
  proof: ProofResult;
  premium: number;
  max: number;
  validity: number;
}

const hintOf = (c: Coverage): FlightKey | RouteKey => ("flight" in c ? c.flight : c.route);

function readEvents(r: RelayResult) {
  let payout = -1, index: number | undefined, lowest: number | undefined, held = false, sent = false, seats = 1;
  const lines: string[] = [];
  for (const e of r.events ?? []) {
    const d = e.data as Record<string, number | string>;
    if (e.event === "claim_verified") {
      payout = Number(d.payout_minor);
      index = Number(d.index_minor);
      seats = Number(d.seats ?? 1);
      lines.push(`Airline price at booking: ${eur(index)}. Payout: ${eur(payout)}${seats > 1 ? ` (${seats} travellers × ${eur(Number(d.payout_per_seat_minor))})` : ""}.`);
    }
    if (e.event === "drop_settled") {
      payout = Number(d.payout_minor);
      lowest = Number(d.lowest_minor);
      lines.push(`Lowest price in your window: ${eur(lowest)}. Payout: ${eur(payout)}.`);
    }
    if (e.event === "payout_held_for_final_check") {
      held = true;
      const at = Number(d.final_check_at);
      lines.push(
        `Approved. The payout is released after a live check of your booking from ${new Date(at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}: bookings can be cancelled free for 24 hours, and refundable tickets until departure. We'll remind you.`,
      );
    }
    if (e.event === "payout_sent" || (e.event === "policy_resolved" && String(d.state) === "paid_out")) sent = true;
    if (e.event === "payout_sent") lines.push("Paid to your account.");
    if (e.event === "payout_failed") lines.push("The transfer failed; you can retry from your policies page.");
    if (e.event === "policy_resolved") lines.push(`Policy closed: ${String(d.state).replace("_", " ")}.`);
  }
  return { payout, index, lowest, held, sent, seats, lines };
}

export default function ClaimClient({ id, registry, demo }: { id: number; registry: string; demo: boolean }) {
  const s = useSession();
  const [p, setP] = useState<Policy | null>(null);
  const [trip, setTrip] = useState<Policy[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<LegResult[]>([]);
  const [offers, setOffers] = useState<DropOffer[]>([]);
  const [drops, setDrops] = useState<number[]>([]);

  const load = async () => {
    try {
      const pol = await getJson<Policy | null>(`/api/policies?id=${id}`);
      setP(pol);
      // Other unclaimed legs of the same trip can use the same booking.
      if (pol?.trip_id !== null && pol?.trip_id !== undefined && s) {
        const all = await getJson<{ policies: Policy[] }>(`/api/policies?account=${s.accountId}`);
        setTrip(all.policies.filter((x) => x.trip_id === pol.trip_id && x.id !== pol.id && x.product === "cap" && x.state === "active").sort((a, b) => a.id - b.id));
      }
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, [id, s]);

  if (s === undefined) return null;
  if (s === null) return <SignInFirst />;
  if (!p) return err ? <Msg kind="error">{err}</Msg> : <p>Loading…</p>;

  const method = p.product === "cap" && p.state === "active" ? "claim_cap" : p.product === "drop" && p.state === "active" ? "settle_drop" : p.state === "claimed" && p.final_check_at ? "finalize_claim" : null;
  // For claims, every active leg of the trip; for settlements and final checks, just this policy.
  const legs = method === "claim_cap" ? [p, ...trip] : [p];

  /** Drop Guarantee after the claim: automatic if chosen at purchase, otherwise offered. */
  async function dropAfterClaim(done: LegResult[]) {
    for (const r of done) {
      const cap = r.policy;
      const a = r.proof.attestation.attestation;
      if (a.status !== "active") continue;
      try {
        const q = await postJson<PremiumQuote & { params: { drop: { purchase_window_secs: number; validity_secs: number } } }>("/api/quote", { coverage: { flight: r.proof.flight_key }, product: "drop" });
        if (q.now > a.booked_at + q.params.drop.purchase_window_secs) continue; // booked too long ago
        if (q.snapshot.price_minor < a.paid_price_minor) continue; // already cheaper: not offered
        const prem = premiumFor(q, "drop", a.paid_price_minor, a.seats);
        const offer = { cap, proof: r.proof, premium: prem.premium, max: maxPremium(prem.premium), validity: q.params.drop.validity_secs };
        if (cap.auto_drop_max_premium_minor !== null) {
          if (prem.premium > cap.auto_drop_max_premium_minor) {
            setSteps((x) => [...x, `Drop Guarantee not added: it would cost ${eur(prem.premium)}, above the ${eur(cap.auto_drop_max_premium_minor!)} you set.`]);
            continue;
          }
          await buyDrop({ ...offer, max: Math.min(offer.max, cap.auto_drop_max_premium_minor) });
        } else {
          setOffers((o) => [...o, offer]);
        }
      } catch (e) {
        setSteps((x) => [...x, `Drop Guarantee not added: ${errText(e)}`]);
      }
    }
  }

  async function buyDrop(o: DropOffer) {
    setBusy(`drop${o.cap.id}`);
    try {
      const r = await gasless(registry, "buy_drop", { attestation: o.proof.attestation, flight_key: o.proof.flight_key, max_premium_minor: o.max, from_cap: o.cap.id });
      const bought = (r.events ?? []).find((e) => e.event === "policy_purchased");
      const active = (r.events ?? []).find((e) => e.event === "policy_active");
      if (!bought || !active) throw new Error("the vault could not lock coverage; your premium went back to your credit");
      const did = Number(bought.data.policy_id);
      setDrops((d) => [...d, did]);
      setOffers((x) => x.filter((y) => y.cap.id !== o.cap.id));
      setSteps((x) => [...x, `Drop Guarantee #${did} added for ${o.proof.flight_key.flight_number}: if the price falls within ${duration(o.validity)}, you get the difference.`]);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onVerified(proofs: ProofResult[]) {
    if (!method || !p) return;
    setBusy("claim");
    setErr(null);
    const done: LegResult[] = [];
    setSteps(proofs.map((r) => {
      const a = r.attestation.attestation;
      return `Booking verified for ${r.flight_key.flight_number}: paid ${eur(a.paid_price_minor)} per traveller, ${a.seats} traveller${a.seats > 1 ? "s" : ""}, ${a.refundable.replace("_", "-")} ticket. No personal data left the checker.`;
    }));
    try {
      // One transaction per leg (each claim has its own index and payout).
      for (const [i, leg] of legs.entries()) {
        const proof = proofs[i];
        if (!proof) continue;
        const args: Record<string, unknown> = { policy_id: leg.id, attestation: proof.attestation };
        if (method === "claim_cap" && "route" in leg.coverage) args.booked_flight = proof.flight_key;
        const res = await gasless(registry, method, args);
        const ev = readEvents(res);
        setSteps((x) => [...x, ...(legs.length > 1 ? [`${coverageLabel(leg.coverage)}:`] : []), ...(ev.lines.length ? ev.lines : ["Submitted."])]);
        if (ev.payout >= 0) done.push({ policy: leg, payout: ev.payout, index: ev.index, lowest: ev.lowest, paid: proof.attestation.attestation.paid_price_minor, seats: ev.seats, held: ev.held, sent: ev.sent, proof });
      }
      setResults(done);
      if (method === "claim_cap" && done.length) await dropAfterClaim(done);
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const total = results.reduce((a, r) => a + r.payout, 0);

  return (
    <div>
      <p>
        {p.product === "cap" ? "Price Cap" : "Drop Guarantee"} #{p.id} for {coverageLabel(p.coverage)}{p.seats > 1 ? `, ${p.seats} travellers` : ""}.
        {p.product === "cap" ? ` Your cap: ${eur(p.strike_minor)}${p.seats > 1 ? " per traveller" : ""}.` : ` You paid: ${eur(p.strike_minor)}${p.seats > 1 ? " per traveller" : ""}.`}
        {"route" in p.coverage ? " Any tracked flight on this route and day counts." : ""}
      </p>
      {trip.length && method === "claim_cap" ? (
        <Msg kind="info">This is a return trip: one check of your booking claims {legs.map((l) => coverageLabel(l.coverage)).join(" and ")}.</Msg>
      ) : null}
      {results.length ? (
        <section className="card claim-result" aria-live="polite">
          <p className="small muted">{results.every((r) => r.sent) ? "Paid to your account" : results.some((r) => r.held) ? "Approved, paid after a live check of your booking" : "Approved"}</p>
          <p className="big num">{eur(total)}</p>
          {results.map((r) => (
            <table key={r.policy.id} className="data" style={{ maxWidth: 460 }}>
              {results.length > 1 ? <caption style={{ textAlign: "left", fontWeight: 700 }}>{coverageLabel(r.policy.coverage)}</caption> : null}
              <tbody>
                {r.index !== undefined ? <tr><th>{"route" in r.policy.coverage ? "Cheapest fare on the route when you booked" : "Airline price when you booked"}</th><td className="r num">{eur(r.index)}</td></tr> : null}
                <tr><th>You paid{r.seats > 1 ? " per traveller" : ""}</th><td className="r num">{eur(r.paid)}</td></tr>
                {r.lowest !== undefined ? <tr><th>Lowest price in your window</th><td className="r num">{eur(r.lowest)}</td></tr> : null}
                {r.policy.product === "cap" ? <tr><th>Your cap</th><td className="r num">−{eur(r.policy.strike_minor)}</td></tr> : null}
                <tr><th>Deductible</th><td className="r num">−{eur(r.policy.deductible_minor)}</td></tr>
                {r.seats > 1 ? <tr><th>Travellers</th><td className="r num">× {r.seats}</td></tr> : null}
                <tr><th>Payout</th><td className="r num"><strong>{eur(r.payout)}</strong></td></tr>
              </tbody>
            </table>
          ))}
        </section>
      ) : null}

      {offers.map((o) => (
        <section key={o.cap.id} className="card" aria-label="Drop Guarantee offer">
          <h2 style={{ fontSize: "var(--s4)" }}>Booked at {eur(o.proof.attestation.attestation.paid_price_minor)}? Protect against a drop too</h2>
          <p>
            If the price of {o.proof.flight_key.flight_number} falls within {duration(o.validity)}, the Drop Guarantee pays the difference
            {o.proof.attestation.attestation.seats > 1 ? ` for all ${o.proof.attestation.attestation.seats} travellers` : ""}. It uses the booking you just verified, so there&apos;s nothing else to upload.
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={!!busy} onClick={() => buyDrop(o)}>{busy === `drop${o.cap.id}` ? "Adding…" : `Add for ${eur(o.premium)}`}</button>
            <button className="btn" onClick={() => setOffers((x) => x.filter((y) => y !== o))}>No thanks</button>
          </div>
        </section>
      ))}
      {drops.length ? <Msg kind="ok">Drop Guarantee{drops.length > 1 ? "s" : ""} {drops.map((d) => `#${d}`).join(" and ")} active. <a href="/policies">See your policies</a>.</Msg> : null}

      {results.length ? null : method ? (
        <>
          <p className="small muted">
            {method === "claim_cap"
              ? "Upload the confirmation of the booking you made while your cap was active."
              : method === "settle_drop"
                ? "Show that your booking is still active at the end of the window. Use your booking code and last name, or upload the confirmation again."
                : "Show that your booking is still active before departure."}
          </p>
          <BookingProof
            hints={legs.map((l) => (l.booked_flight ?? hintOf(l.coverage)))}
            flightKey={"flight" in p.coverage ? p.coverage.flight : p.booked_flight ?? undefined}
            demo={demo}
            onVerifiedAll={onVerified}
            onVerified={(r) => onVerified([r])}
            defaultPaid={p.product === "cap" ? 25500 : p.strike_minor}
            defaultPassengers={p.seats}
            liveOnly={method === "finalize_claim" || method === "settle_drop"}
          />
        </>
      ) : (
        <Msg kind="info">Nothing to do for this policy right now ({p.state.replace("_", " ")}).</Msg>
      )}
      {busy === "claim" ? <Msg kind="info">Submitting your claim…</Msg> : null}
      {steps.length ? (
        <ol className="card small">
          {steps.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
      ) : null}
      {err ? <Msg kind="error">{err}</Msg> : null}
      <p><a href="/policies">Back to your policies</a></p>
    </div>
  );
}

