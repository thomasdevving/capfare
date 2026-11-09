"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { computePremium, FARE_CLASSES, validateFlightKey, type FlightKey, type Params, type SnapshotRecord, type VaultState } from "@capfare/shared";
import { commitmentFor, gasless, rememberedLastName, rememberLastName } from "@/lib/wallet";
import { dateTime, duration, eur, usdc } from "@/lib/format";
import { errText, getJson, Msg, postJson, SignInFirst, useSession } from "./ui";
import BookingProof, { type ProofResult } from "./BookingProof";

interface QuoteData {
  flight_key_hash: string;
  snapshot: SnapshotRecord;
  vault: VaultState;
  params: Params;
  exposure: [number, number];
  now: number;
  oracleNote: string | null;
}

interface Cfg {
  registry: string;
  token: string;
  demo: boolean;
}

const FARE_LABEL: Record<string, string> = {
  economy_light: "Economy Light",
  economy_standard: "Economy Standard",
  economy_flex: "Economy Flex",
  premium_economy: "Premium Economy",
  business: "Business",
};

/** Reads flight details from a pasted booking link (demo site, or common query names). */
export function parseBookingUrl(s: string): Partial<FlightKey> & { hint?: number } {
  try {
    const u = new URL(s);
    const q = u.searchParams;
    const fn = q.get("fn") ?? q.get("flight") ?? q.get("flightNumber") ?? "";
    return {
      flight_number: fn.toUpperCase(),
      airline: fn.slice(0, 2).toUpperCase(),
      departure_date: q.get("date") ?? q.get("departureDate") ?? "",
      origin: (q.get("from") ?? q.get("origin") ?? "").toUpperCase(),
      destination: (q.get("to") ?? q.get("destination") ?? "").toUpperCase(),
      fare_class: q.get("fare") ?? "economy_light",
      hint: q.get("price") ? Math.round(Number(q.get("price")) * 100) : undefined,
    };
  } catch {
    return {};
  }
}

export default function QuoteClient({ cfg }: { cfg: Cfg }) {
  const sp = useSearchParams();
  const s = useSession();
  const [product, setProduct] = useState<"cap" | "drop">(sp.get("product") === "drop" ? "drop" : "cap");
  const [fk, setFk] = useState<FlightKey>({
    airline: (sp.get("fn") ?? "KL").slice(0, 2).toUpperCase(),
    flight_number: (sp.get("fn") ?? "KL1695").toUpperCase(),
    departure_date: sp.get("date") ?? "2027-06-14",
    origin: (sp.get("from") ?? "AMS").toUpperCase(),
    destination: (sp.get("to") ?? "BCN").toUpperCase(),
    fare_class: sp.get("fare") ?? "economy_light",
  });
  const [hint, setHint] = useState<number | undefined>(sp.get("hint") ? Number(sp.get("hint")) : undefined);
  const [link, setLink] = useState("");
  const [q, setQ] = useState<QuoteData | null>(null);
  const [cap, setCap] = useState(0);
  const [credit, setCredit] = useState<string | null>(null);
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [lastName, setLastName] = useState("");
  useEffect(() => setLastName(rememberedLastName()), []);

  useEffect(() => {
    if (!s) return;
    getJson<{ credit: string }>(`/api/policies?account=${s.accountId}`).then((j) => setCredit(j.credit)).catch(() => {});
  }, [s, done]);

  const fkErr = validateFlightKey(fk);

  async function getQuote(key: FlightKey = fk) {
    setBusy("quote");
    setErr(null);
    setQ(null);
    setDone(null);
    try {
      const j = await postJson<QuoteData>("/api/quote", { flight_key: key, product });
      setQ(j);
      setCap(Math.ceil((j.snapshot.price_minor * 1.06) / 500) * 500);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const strike = product === "drop" ? proof?.attestation.attestation.paid_price_minor ?? 0 : cap;
  const pp = q ? q.params[product] : null;
  const premium = useMemo(() => {
    if (!q || !pp || !strike) return null;
    try {
      return computePremium(pp, {
        product,
        current_price: q.snapshot.price_minor,
        strike,
        signals: q.snapshot.signals,
        now: q.now,
        departure_ts: q.snapshot.departure_ts,
        vault_total_assets: q.vault.total_assets,
        vault_locked: q.vault.locked_coverage,
        vault_reserved: q.vault.pending_withdrawals,
        new_lock: (BigInt(pp.max_payout) * BigInt(q.params.global.usdc_micro_per_cent)).toString(),
        flight_exposure: q.exposure[0],
      });
    } catch (e) {
      return { error: errText(e) } as const;
    }
  }, [q, pp, strike, product]);

  const premiumOk = premium && !("error" in premium) ? premium : null;
  const maxPay = premiumOk ? premiumOk.premium + Math.max(10, Math.ceil(premiumOk.premium * 0.03)) : 0;
  const premiumUsdc = q && premiumOk ? BigInt(maxPay) * BigInt(q.params.global.usdc_micro_per_cent) : 0n;
  const enoughCredit = credit !== null && BigInt(credit) >= premiumUsdc;

  async function buy() {
    if (!q || !premiumOk) return;
    setBusy("buy");
    setErr(null);
    try {
      if (product === "cap" && !lastName.trim()) throw new Error("Enter the lead passenger's last name");
      if (product === "cap") rememberLastName(lastName.trim());
      const r =
        product === "cap"
          ? await gasless(cfg.registry, "buy_cap", { flight_key: fk, strike_minor: cap, max_premium_minor: maxPay, passenger_commitment: await commitmentFor(lastName) })
          : await gasless(cfg.registry, "buy_drop", { attestation: proof!.attestation, flight_key: proof!.flight_key, max_premium_minor: maxPay });
      const ev = (r.events ?? []).find((e) => e.event === "policy_purchased");
      const active = (r.events ?? []).find((e) => e.event === "policy_active");
      if (!ev || !active) throw new Error("The vault could not lock coverage; your premium went back to your credit. Try again later.");
      setDone(Number(ev.data.policy_id));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="btn-row" role="radiogroup" aria-label="What do you need?" style={{ marginBottom: 16 }}>
        <button role="radio" aria-checked={product === "cap"} className={`btn ${product === "cap" ? "btn-primary" : ""}`} onClick={() => { setProduct("cap"); setQ(null); }}>Not booked yet: Price Cap</button>
        <button role="radio" aria-checked={product === "drop"} className={`btn ${product === "drop" ? "btn-primary" : ""}`} onClick={() => { setProduct("drop"); setQ(null); }}>Just booked: Drop Guarantee</button>
      </div>

      {product === "drop" && !proof ? (
        <>
          <p>First show us your booking. The Drop Guarantee covers the flight and price on your confirmation.</p>
          <BookingProof
            flightKey={validateFlightKey(fk) ? undefined : fk}
            demo={cfg.demo}
            defaultPaid={22000}
            onVerified={(r) => {
              setProof(r);
              setFk(r.flight_key);
              getQuote(r.flight_key);
            }}
          />
          <details className="card">
            <summary>Flight details (used for the demo confirmation)</summary>
            <FlightForm fk={fk} setFk={setFk} />
          </details>
        </>
      ) : null}

      {product === "cap" ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            getQuote();
          }}
        >
          <label htmlFor="link">Paste a booking link</label>
          <input
            id="link"
            value={link}
            placeholder="https://…"
            onChange={(e) => {
              setLink(e.target.value);
              const p = parseBookingUrl(e.target.value);
              if (p.flight_number) {
                setFk((f) => ({ ...f, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => v && k !== "hint")) }) as FlightKey);
                setHint(p.hint);
              }
            }}
          />
          <p className="hint">Or enter the flight below.</p>
          <FlightForm fk={fk} setFk={setFk} />
          {fkErr ? <p className="hint">{fkErr}</p> : null}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!!fkErr || busy === "quote"}>{busy === "quote" ? "Getting the airline price…" : "Get a quote"}</button>
          </div>
        </form>
      ) : null}

      {err ? <Msg kind="error">{err}</Msg> : null}

      {q && pp ? (
        <section className="card" aria-labelledby="quote-title">
          <h2 id="quote-title" style={{ fontSize: "var(--s5)" }}>
            {fk.flight_number} {fk.origin}→{fk.destination}, {fk.departure_date}, {FARE_LABEL[fk.fare_class]}
          </h2>
          <p>
            Verified airline price: <strong className="num">{eur(q.snapshot.price_minor)}</strong> <span className="small muted">(checked {dateTime(q.snapshot.observed_at)}{q.snapshot.demo ? ", demo price source" : ""})</span>
          </p>
          {hint ? <p className="small muted">The page you came from showed {eur(hint)}. We always use the verified airline price.</p> : null}
          {!q.snapshot.available ? <Msg kind="error">This fare class is sold out. We can&apos;t offer protection for it.</Msg> : null}

          {product === "cap" ? (
            <>
              <label htmlFor="cap">Your maximum price: <span className="num">{eur(cap)}</span></label>
              <input id="cap" type="range" min={q.snapshot.price_minor} max={Math.round(q.snapshot.price_minor * 1.5)} step={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
            </>
          ) : (
            <p>
              You paid <strong className="num">{eur(strike)}</strong>. If the price of this flight drops within {duration(pp.validity_secs)}, you get the difference.
            </p>
          )}

          {premium && "error" in premium ? <Msg kind="error">{premium.error}</Msg> : null}
          {premiumOk ? (
            <table className="data" style={{ maxWidth: 520 }}>
              <tbody>
                <tr><th>Premium</th><td className="r num"><strong>{eur(premiumOk.premium)}</strong></td></tr>
                <tr><th>Deductible</th><td className="r num">{eur(pp.deductible)}</td></tr>
                <tr><th>Maximum payout</th><td className="r num">{eur(pp.max_payout)}</td></tr>
                {product === "cap" ? <tr><th>Starts after</th><td className="r">{duration(pp.activation_delay_secs)}</td></tr> : null}
                <tr><th>Valid for</th><td className="r">{duration(pp.validity_secs)}</td></tr>
                <tr><th>Locked in the vault for you</th><td className="r num">{usdc((BigInt(pp.max_payout) * BigInt(q.params.global.usdc_micro_per_cent)).toString())} tUSDC</td></tr>
              </tbody>
            </table>
          ) : null}
          {premiumOk && product === "cap" ? (
            <p className="small muted" style={{ marginTop: 12 }}>
              Example: if you book at {eur(cap + 5000)} while the airline asks {eur(cap + 5000)}, you get {eur(Math.max(0, Math.min(5000 - pp.deductible, pp.max_payout)))}.
            </p>
          ) : null}

          {done ? (
            <Msg kind="ok">
              Protection #{done} is active. <a href="/policies">See your policies</a>.
            </Msg>
          ) : s === null ? (
            <SignInFirst />
          ) : premiumOk && s ? (
            <>
              <p className="small">
                Your credit: <strong className="num">{credit ? usdc(credit) : "…"} tUSDC</strong>. You pay at most {eur(maxPay)} ({usdc(premiumUsdc.toString())} tUSDC) if the price moves slightly before confirmation.
              </p>
              {product === "cap" ? (
                <div style={{ maxWidth: 420, marginBottom: 12 }}>
                  <label htmlFor="lastname">Lead passenger&apos;s last name (as it will be on the booking)</label>
                  <input id="lastname" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                  <p className="hint">Only a scrambled fingerprint of the name is stored, so only your booking can be used to claim. The name itself never leaves this device.</p>
                </div>
              ) : null}
              {!enoughCredit && credit !== null ? (
                <Msg kind="info">Not enough credit. <a href="/credit">Top up your credit</a> first.</Msg>
              ) : (
                <button className="btn btn-primary" onClick={buy} disabled={busy === "buy" || !q.snapshot.available}>
                  {busy === "buy" ? "Locking your price…" : product === "cap" ? `Lock ${eur(cap)} for ${eur(premiumOk.premium)}` : `Add the Drop Guarantee for ${eur(premiumOk.premium)}`}
                </button>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function FlightForm({ fk, setFk }: { fk: FlightKey; setFk: (f: FlightKey) => void }) {
  const up = (k: keyof FlightKey, v: string) => {
    const n = { ...fk, [k]: k === "fare_class" || k === "departure_date" ? v : v.toUpperCase().replace(/\s/g, "") };
    if (k === "flight_number") n.airline = n.flight_number.slice(0, 2);
    setFk(n);
  };
  return (
    <div className="grid2">
      <div>
        <label htmlFor="fn">Flight number</label>
        <input id="fn" value={fk.flight_number} onChange={(e) => up("flight_number", e.target.value)} placeholder="KL1695" />
      </div>
      <div>
        <label htmlFor="date">Departure date</label>
        <input id="date" type="date" value={fk.departure_date} onChange={(e) => up("departure_date", e.target.value)} />
      </div>
      <div>
        <label htmlFor="from">From (airport code)</label>
        <input id="from" value={fk.origin} maxLength={3} onChange={(e) => up("origin", e.target.value)} placeholder="AMS" />
      </div>
      <div>
        <label htmlFor="to">To (airport code)</label>
        <input id="to" value={fk.destination} maxLength={3} onChange={(e) => up("destination", e.target.value)} placeholder="BCN" />
      </div>
      <div>
        <label htmlFor="fare">Fare class</label>
        <select id="fare" value={fk.fare_class} onChange={(e) => up("fare_class", e.target.value)}>
          {FARE_CLASSES.map((f) => (
            <option key={f} value={f}>{FARE_LABEL[f]}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
