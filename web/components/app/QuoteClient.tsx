"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  coverageLabel, FARE_CLASSES, MAX_SEATS, parseBookingLink, validateCoverage, validateFlightKey,
  type Coverage, type FlightKey, type Params, type RouteKey, type SnapshotRecord, type VaultState,
} from "@capfare/shared";
import { commitmentFor, gasless, rememberedLastName, rememberLastName } from "@/lib/wallet";
import { dateTime, duration, eur, usdc } from "@/lib/format";
import { maxPremium, premiumFor } from "@/lib/premium";
import { errText, getJson, Msg, postJson, SignInFirst, useSession } from "./ui";
import BookingProof, { type ProofResult } from "./BookingProof";
import WatchButton from "./WatchButton";

interface QuoteData {
  flight_key_hash: string;
  snapshot: SnapshotRecord;
  vault: VaultState;
  params: Params;
  exposure: [number, number];
  now: number;
  oracleNote: string | null;
  routeFlights?: { flight_key: FlightKey; price_minor: number; available: boolean }[];
}

interface Cfg {
  registry: string;
  token: string;
  demo: boolean;
}

export const FARE_LABEL: Record<string, string> = {
  economy_light: "Economy Light",
  economy_standard: "Economy Standard",
  economy_flex: "Economy Flex",
  premium_economy: "Premium Economy",
  business: "Business",
};

const addDays = (d: string, n: number) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : d);

export type LinkRead = Partial<FlightKey> & { hint?: number; pax?: number; ret?: string };

/**
 * Reads the trip from a pasted or shared booking link: CapFare's own query names (fn, fare,
 * price) plus whatever the shared reader finds in links from any airline, agency or comparison
 * site (query, hash, path, Google Flights' encoded search). Share sheets add text around the link.
 */
export function parseBookingUrl(s: string): LinkRead {
  const any = parseBookingLink(s);
  let q: URLSearchParams;
  try {
    q = new URL(any?.url ?? s.trim()).searchParams;
  } catch {
    return {};
  }
  const fn = (q.get("fn") ?? q.get("flight") ?? q.get("flightNumber") ?? any?.flight_number ?? "").replace(/\s/g, "").toUpperCase();
  const out: LinkRead = {
    flight_number: fn || undefined,
    airline: fn ? fn.slice(0, 2) : undefined,
    departure_date: any?.date ?? q.get("date") ?? undefined,
    origin: any?.origin ?? (q.get("from") ?? q.get("origin") ?? "").toUpperCase(),
    destination: any?.destination ?? (q.get("to") ?? q.get("destination") ?? "").toUpperCase(),
    fare_class: q.get("fare") && (FARE_CLASSES as readonly string[]).includes(q.get("fare")!) ? q.get("fare")! : undefined,
    hint: q.get("price") ? Math.round(Number(q.get("price")) * 100) : undefined,
    pax: q.get("pax") ? Number(q.get("pax")) : any?.travellers,
    ret: q.get("ret") ?? any?.return_date,
  };
  for (const k of Object.keys(out) as (keyof LinkRead)[]) if (out[k] === undefined || out[k] === "") delete out[k];
  return out;
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const routeOf = (f: FlightKey): RouteKey => ({ origin: f.origin, destination: f.destination, departure_date: f.departure_date, fare_class: f.fare_class });
const travellers = (n: number) => (n > 1 ? ` for ${n} travellers` : "");

export default function QuoteClient({ cfg }: { cfg: Cfg }) {
  const sp = useSearchParams();
  const s = useSession();
  const [product, setProduct] = useState<"cap" | "drop">(sp.get("product") === "drop" ? "drop" : "cap");
  const [scope, setScope] = useState<"flight" | "route">(sp.get("scope") === "route" ? "route" : "flight");
  const [trip, setTrip] = useState<"oneway" | "return">(sp.get("ret") ? "return" : "oneway");
  const [seats, setSeats] = useState(Math.min(MAX_SEATS, Math.max(1, Number(sp.get("pax") ?? 1) || 1)));
  const [fk, setFk] = useState<FlightKey>({
    airline: (sp.get("fn") ?? "KL").slice(0, 2).toUpperCase(),
    flight_number: (sp.get("fn") ?? "KL1695").toUpperCase(),
    departure_date: sp.get("date") ?? "2027-06-14",
    origin: (sp.get("from") ?? "AMS").toUpperCase(),
    destination: (sp.get("to") ?? "BCN").toUpperCase(),
    fare_class: sp.get("fare") ?? "economy_light",
  });
  const [rfk, setRfk] = useState<FlightKey>({
    airline: (sp.get("rfn") ?? "").slice(0, 2).toUpperCase(),
    flight_number: (sp.get("rfn") ?? "").toUpperCase(),
    departure_date: sp.get("ret") ?? addDays(sp.get("date") ?? "2027-06-14", 7),
    origin: (sp.get("to") ?? "BCN").toUpperCase(),
    destination: (sp.get("from") ?? "AMS").toUpperCase(),
    fare_class: sp.get("fare") ?? "economy_light",
  });
  const [hint, setHint] = useState<number | undefined>(sp.get("hint") ? Number(sp.get("hint")) : undefined);
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteData[] | null>(null);
  const [caps, setCaps] = useState<number[]>([]);
  const [autoDrop, setAutoDrop] = useState(false);
  const [credit, setCredit] = useState<string | null>(null);
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number[] | null>(null);
  const [lastName, setLastName] = useState("");
  useEffect(() => setLastName(rememberedLastName()), []);

  useEffect(() => {
    if (!s) return;
    getJson<{ credit: string }>(`/api/policies?account=${s.accountId}`).then((j) => setCredit(j.credit)).catch(() => {});
  }, [s, done]);

  /** Fill the form from a pasted or shared link and say what was found. */
  function applyLink(v: string) {
    setLink(v);
    if (!v.trim()) return setLinkNote(null);
    const p = parseBookingUrl(v);
    const { hint: h, pax, ret, ...k } = p;
    if (!k.flight_number && !k.origin && !k.departure_date) {
      return setLinkNote("We couldn't read a flight from that link. Some sites keep the search out of the address; enter the trip below.");
    }
    reset();
    setFk((f) => ({ ...f, ...k }) as FlightKey);
    // No flight number in the link: cover any flight on the route and day.
    if (!k.flight_number && k.origin && k.destination) setScope("route");
    else if (k.flight_number) setScope("flight");
    setHint(h);
    if (pax) setSeats(Math.min(MAX_SEATS, Math.max(1, pax)));
    if (ret) {
      setTrip("return");
      setRfk((r) => ({ ...r, departure_date: ret, origin: k.destination ?? r.origin, destination: k.origin ?? r.destination }));
    }
    const found = [k.flight_number, k.origin && k.destination ? `${k.origin} → ${k.destination}` : null, k.departure_date ? dayLabel(k.departure_date) : null, ret ? `return ${dayLabel(ret)}` : null, pax ? `${pax} traveller${pax > 1 ? "s" : ""}` : null].filter(Boolean);
    const missing = [!k.departure_date ? "the date" : null, !(k.origin && k.destination) ? "the airports" : null].filter(Boolean);
    setLinkNote(
      `Found ${found.join(" · ")}.` +
        (!k.flight_number && k.origin && k.destination ? " No flight number in the link, so we chose any flight on this route and day." : "") +
        (missing.length ? ` Add ${missing.join(" and ")} below.` : ""),
    );
  }

  // Shared to CapFare from another app (installed web app share target): ?link=… or ?text=….
  useEffect(() => {
    const shared = sp.get("link") ?? sp.get("text") ?? sp.get("title");
    if (shared && /https?:\/\//.test(shared)) applyLink(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** What each leg covers. A Drop Guarantee always covers the booked flight. */
  const coverages: Coverage[] = useMemo(() => {
    if (product === "drop") return [{ flight: fk }];
    const legs = trip === "return" ? [fk, rfk] : [fk];
    return legs.map((k) => (scope === "route" ? { route: routeOf(k) } : { flight: k }));
  }, [product, scope, trip, fk, rfk]);
  const formErr =
    product === "cap" && scope === "flight" && trip === "return" && !rfk.flight_number
      ? "Enter the return flight number (or choose “Any flight on this route and day”)."
      : coverages.map(validateCoverage).find(Boolean) ?? (trip === "return" && product === "cap" && rfk.departure_date < fk.departure_date ? "The return date must be after the outbound date." : null);

  const reset = () => {
    setQuotes(null);
    setDone(null);
  };

  async function getQuote(list: Coverage[] = coverages) {
    setBusy("quote");
    setErr(null);
    reset();
    try {
      const qs = await Promise.all(list.map((coverage) => postJson<QuoteData>("/api/quote", { coverage, product })));
      setQuotes(qs);
      setCaps(qs.map((q) => Math.ceil((q.snapshot.price_minor * 1.06) / 500) * 500));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const policySeats = product === "drop" ? proof?.attestation.attestation.seats ?? 1 : seats;
  const strikes = product === "drop" ? [proof?.attestation.attestation.paid_price_minor ?? 0] : caps;
  const pp = quotes ? quotes[0].params[product] : null;

  /** Premiums per leg, priced like the contract: the second leg sees the first leg's lock. */
  const premiums = useMemo(() => {
    if (!quotes) return null;
    let extra = 0n;
    return quotes.map((q, i) => {
      try {
        if (!strikes[i]) throw new Error("set your maximum price");
        const p = premiumFor(q, product, strikes[i], policySeats, extra);
        extra += p.lock;
        return p;
      } catch (e) {
        return { error: errText(e) } as const;
      }
    });
  }, [quotes, strikes, product, policySeats]);

  const ok = premiums && premiums.every((p) => !("error" in p)) ? (premiums as Exclude<(typeof premiums)[number], { error: string }>[]) : null;
  const premiumTotal = ok ? ok.reduce((a, p) => a + p.premium, 0) : 0;
  const maxPays = ok ? ok.map((p) => maxPremium(p.premium)) : [];
  const rate = quotes ? BigInt(quotes[0].params.global.usdc_micro_per_cent) : 0n;
  const maxPayTotal = maxPays.reduce((a, b) => a + b, 0);
  const premiumUsdc = BigInt(maxPayTotal) * rate;
  const enoughCredit = credit !== null && BigInt(credit) >= premiumUsdc;
  // Drop option: the most a Drop Guarantee for these travellers can cost (per outbound leg).
  const dropCeiling = quotes ? quotes[0].params.drop.max_premium * policySeats : 0;
  const allAvailable = quotes?.every((q) => q.snapshot.available) ?? false;

  async function buy() {
    if (!quotes || !ok) return;
    setBusy("buy");
    setErr(null);
    try {
      let r;
      if (product === "cap") {
        if (!lastName.trim()) throw new Error("Enter the lead passenger's last name");
        rememberLastName(lastName.trim());
        r = await gasless(cfg.registry, "buy_caps", {
          purchase: {
            legs: coverages.map((coverage, i) => ({ coverage, strike_minor: caps[i], max_premium_minor: maxPays[i] })),
            seats,
            passenger_commitment: await commitmentFor(lastName),
            auto_drop_max_premium_minor: autoDrop ? dropCeiling : null,
          },
        });
      } else {
        r = await gasless(cfg.registry, "buy_drop", { attestation: proof!.attestation, flight_key: proof!.flight_key, max_premium_minor: maxPays[0] });
      }
      const bought = (r.events ?? []).filter((e) => e.event === "policy_purchased").map((e) => Number(e.data.policy_id));
      const active = (r.events ?? []).filter((e) => e.event === "policy_active");
      if (!bought.length || active.length < bought.length) throw new Error("The vault could not lock coverage; your premium went back to your credit. Try again later.");
      setDone(bought);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const legName = (i: number) => (coverages.length > 1 ? (i === 0 ? "Outbound" : "Return") : "");

  return (
    <div>
      <div className="btn-row" role="radiogroup" aria-label="What do you need?" style={{ marginBottom: 16 }}>
        <button role="radio" aria-checked={product === "cap"} className={`btn ${product === "cap" ? "btn-primary" : ""}`} onClick={() => { setProduct("cap"); reset(); }}>Not booked yet: Price Cap</button>
        <button role="radio" aria-checked={product === "drop"} className={`btn ${product === "drop" ? "btn-primary" : ""}`} onClick={() => { setProduct("drop"); reset(); }}>Just booked: Drop Guarantee</button>
      </div>

      {product === "drop" && !proof ? (
        <>
          <p>First show us your booking. The Drop Guarantee covers the flight, price and travellers on your confirmation.</p>
          <BookingProof
            flightKey={validateFlightKey(fk) ? undefined : fk}
            demo={cfg.demo}
            defaultPaid={22000}
            onVerified={(r) => {
              setProof(r);
              setFk(r.flight_key);
              getQuote([{ flight: r.flight_key }]);
            }}
          />
          <details className="card">
            <summary>Flight details (used for the demo confirmation)</summary>
            <FlightForm id="o" fk={fk} setFk={setFk} />
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
          <label htmlFor="link">Paste a link from any booking site</label>
          <input id="link" value={link} placeholder="https://… (airline, travel agency, Google Flights, Skyscanner, …)" inputMode="url" autoComplete="off" onChange={(e) => applyLink(e.target.value)} />
          {linkNote ? <p className="hint" role="status">{linkNote}</p> : null}
          <p className="hint">Copy the address of the search results or the flight you&apos;re looking at. Or enter your trip below.</p>

          <fieldset className="choice-row">
            <legend>Which flights?</legend>
            <label><input type="radio" name="scope" checked={scope === "flight"} onChange={() => { setScope("flight"); reset(); }} /> This exact flight</label>
            <label><input type="radio" name="scope" checked={scope === "route"} onChange={() => { setScope("route"); reset(); }} /> Any flight on this route and day <span className="tag">option</span></label>
          </fieldset>
          {scope === "route" ? (
            <p className="hint">Not sure which flight yet? We track every non-stop flight on the route and day. Your cap applies to the cheapest fare among them, and you can book whichever one you like.</p>
          ) : null}
          <fieldset className="choice-row">
            <legend>Trip</legend>
            <label><input type="radio" name="trip" checked={trip === "oneway"} onChange={() => { setTrip("oneway"); reset(); }} /> One-way</label>
            <label><input type="radio" name="trip" checked={trip === "return"} onChange={() => { setTrip("return"); reset(); }} /> Return</label>
            <label className="inline-select">
              Travellers
              <select aria-label="Travellers" value={seats} onChange={(e) => { setSeats(Number(e.target.value)); }}>
                {Array.from({ length: MAX_SEATS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </fieldset>

          {trip === "return" ? <h3 className="leg-title">Outbound</h3> : null}
          <FlightForm id="o" fk={fk} setFk={(k) => { setFk(k); setRfk((r) => ({ ...r, origin: k.destination, destination: k.origin, fare_class: r.flight_number ? r.fare_class : k.fare_class })); }} routeOnly={scope === "route"} />
          {trip === "return" ? (
            <>
              <h3 className="leg-title">Return</h3>
              <FlightForm id="r" fk={rfk} setFk={setRfk} routeOnly={scope === "route"} />
            </>
          ) : null}
          {formErr ? <p className="hint">{formErr}</p> : null}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!!formErr || busy === "quote"}>{busy === "quote" ? "Getting the airline price…" : "Get a quote"}</button>
          </div>
        </form>
      ) : null}

      {err ? <Msg kind="error">{err}</Msg> : null}

      {quotes && pp ? (
        <section className="card" aria-labelledby="quote-title">
          <h2 id="quote-title" style={{ fontSize: "var(--s5)" }}>
            {coverages.length > 1 ? `Return trip ${fk.origin}⇄${fk.destination}` : `${coverageLabel(coverages[0])}, ${FARE_LABEL[fk.fare_class]}`}
            {travellers(policySeats)}
          </h2>
          {hint ? <p className="small muted">The page you came from showed {eur(hint)}. We always use the verified airline price.</p> : null}

          {quotes.map((q, i) => {
            const c = coverages[i];
            const prem = premiums?.[i];
            return (
              <div key={i} className="quote-leg">
                {legName(i) ? <h3 className="leg-title">{legName(i)}: {coverageLabel(c)}</h3> : null}
                <p>
                  {"route" in c ? "Cheapest verified fare on the route" : "Verified airline price"}: <strong className="num">{eur(q.snapshot.price_minor)}</strong>{" "}
                  <span className="small muted">(checked {dateTime(q.snapshot.observed_at)}{q.snapshot.demo ? ", demo price source" : ""})</span>
                </p>
                {"route" in c && q.routeFlights?.length ? (
                  <details className="small">
                    <summary>{q.routeFlights.length} flights in this route index</summary>
                    <ul className="route-flights">
                      {[...q.routeFlights].sort((a, b) => a.price_minor - b.price_minor).map((f) => (
                        <li key={f.flight_key.flight_number}>
                          <span>{f.flight_key.flight_number}</span> <span className="num">{f.available ? eur(f.price_minor) : "sold out"}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {!q.snapshot.available ? <Msg kind="error">This fare class is sold out. We can&apos;t offer protection for it.</Msg> : null}
                {product === "cap" ? (
                  <>
                    <label htmlFor={i === 0 ? "cap" : `cap${i}`}>{legName(i) ? `${legName(i)} maximum price` : "Your maximum price"} per traveller: <span className="num">{eur(caps[i] ?? 0)}</span></label>
                    <input id={i === 0 ? "cap" : `cap${i}`} type="range" min={q.snapshot.price_minor} max={Math.round(q.snapshot.price_minor * 1.5)} step={100} value={caps[i] ?? 0} onChange={(e) => setCaps(caps.map((x, j) => (j === i ? Number(e.target.value) : x)))} />
                  </>
                ) : (
                  <p>
                    You paid <strong className="num">{eur(strikes[0])}</strong> per traveller. If the price of this flight drops within {duration(pp.validity_secs)}, you get the difference{travellers(policySeats)}.
                  </p>
                )}
                {prem && "error" in prem ? <Msg kind="error">{prem.error}</Msg> : null}
              </div>
            );
          })}

          {ok ? (
            <table className="data" style={{ maxWidth: 560 }}>
              <tbody>
                {ok.map((p, i) => (
                  <tr key={i}><th>Premium{legName(i) ? ` (${legName(i).toLowerCase()})` : ""}</th><td className="r num"><strong>{eur(p.premium)}</strong>{policySeats > 1 ? <span className="small muted"> ({policySeats} × {eur(p.per_seat)})</span> : null}</td></tr>
                ))}
                {ok.length > 1 ? <tr><th>Total premium</th><td className="r num"><strong>{eur(premiumTotal)}</strong></td></tr> : null}
                <tr><th>Deductible per traveller</th><td className="r num">{eur(pp.deductible)}</td></tr>
                <tr><th>Maximum payout{ok.length > 1 ? " per flight" : ""}</th><td className="r num">{eur(pp.max_payout * policySeats)}{policySeats > 1 ? <span className="small muted"> ({policySeats} × {eur(pp.max_payout)})</span> : null}</td></tr>
                {product === "cap" ? <tr><th>Starts after</th><td className="r">{duration(pp.activation_delay_secs)}</td></tr> : null}
                <tr><th>Valid for</th><td className="r">{duration(pp.validity_secs)}</td></tr>
                <tr><th>Locked in the vault for you</th><td className="r num">{usdc(ok.reduce((a, p) => a + p.lock, 0n).toString())} tUSDC</td></tr>
              </tbody>
            </table>
          ) : null}
          {ok && product === "cap" ? (
            <p className="small muted" style={{ marginTop: 12 }}>
              Example: if you book at {eur(caps[0] + 5000)} per traveller while the airline asks {eur(caps[0] + 5000)}, you get {eur(Math.max(0, Math.min(5000 - pp.deductible, pp.max_payout)) * policySeats)}{travellers(policySeats)}.
              {scope === "route" ? " For route cover the airline price is the cheapest fare on the route at the time you book." : ""}
            </p>
          ) : null}

          {product === "cap" && allAvailable ? <WatchButton coverages={coverages} seats={seats} prices={quotes.map((q) => q.snapshot.price_minor)} highlight={sp.get("watch") === "1"} /> : null}

          {done ? (
            <Msg kind="ok">
              {done.length > 1 ? `Protections ${done.map((d) => `#${d}`).join(" and ")} are active.` : `Protection #${done[0]} is active.`} <a href="/policies">See your policies</a>.
            </Msg>
          ) : s === null ? (
            <SignInFirst />
          ) : ok && s ? (
            <>
              <p className="small">
                Your credit: <strong className="num">{credit ? usdc(credit) : "…"} tUSDC</strong>. You pay at most {eur(maxPayTotal)} ({usdc(premiumUsdc.toString())} tUSDC) if the price moves slightly before confirmation.
              </p>
              {product === "cap" ? (
                <>
                  <div style={{ maxWidth: 420, marginBottom: 12 }}>
                    <label htmlFor="lastname">Lead passenger&apos;s last name (as it will be on the booking)</label>
                    <input id="lastname" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                    <p className="hint">Only a scrambled fingerprint of the name is stored, so only your booking can be used to claim. The name itself never leaves this device.</p>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={autoDrop} onChange={(e) => setAutoDrop(e.target.checked)} />
                    <span>
                      <strong>Option: protect against a drop too.</strong> When I claim with my booking, also add a Drop Guarantee for it (premium from the same public formula, at most {eur(dropCeiling)}{coverages.length > 1 ? " per flight" : ""}). If the price then falls within {duration(quotes[0].params.drop.validity_secs)}, you get the difference.
                    </span>
                  </label>
                </>
              ) : null}
              {!enoughCredit && credit !== null ? (
                <Msg kind="info">Not enough credit. <a href="/credit">Top up your credit</a> first.</Msg>
              ) : (
                <button className="btn btn-primary" onClick={buy} disabled={busy === "buy" || !allAvailable}>
                  {busy === "buy"
                    ? "Locking your price…"
                    : product === "cap"
                      ? ok.length > 1
                        ? `Lock both flights for ${eur(premiumTotal)}`
                        : `Lock ${eur(caps[0])} for ${eur(premiumTotal)}`
                      : `Add the Drop Guarantee for ${eur(premiumTotal)}`}
                </button>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function FlightForm({ id, fk, setFk, routeOnly = false }: { id: string; fk: FlightKey; setFk: (f: FlightKey) => void; routeOnly?: boolean }) {
  const up = (k: keyof FlightKey, v: string) => {
    const n = { ...fk, [k]: k === "fare_class" || k === "departure_date" ? v : v.toUpperCase().replace(/\s/g, "") };
    if (k === "flight_number") n.airline = n.flight_number.slice(0, 2);
    setFk(n);
  };
  // The outbound form keeps the original ids (fn, date, from, to, fare) for links and tests.
  const fid = (x: string) => (id === "o" ? x : `${id}-${x}`);
  return (
    <div className="grid2">
      {!routeOnly ? (
        <div>
          <label htmlFor={fid("fn")}>Flight number</label>
          <input id={fid("fn")} value={fk.flight_number} onChange={(e) => up("flight_number", e.target.value)} placeholder="KL1695" />
        </div>
      ) : null}
      <div>
        <label htmlFor={fid("date")}>Departure date</label>
        <input id={fid("date")} type="date" value={fk.departure_date} onChange={(e) => up("departure_date", e.target.value)} />
      </div>
      <div>
        <label htmlFor={fid("from")}>From (airport code)</label>
        <input id={fid("from")} value={fk.origin} maxLength={3} onChange={(e) => up("origin", e.target.value)} placeholder="AMS" />
      </div>
      <div>
        <label htmlFor={fid("to")}>To (airport code)</label>
        <input id={fid("to")} value={fk.destination} maxLength={3} onChange={(e) => up("destination", e.target.value)} placeholder="BCN" />
      </div>
      <div>
        <label htmlFor={fid("fare")}>Fare class</label>
        <select id={fid("fare")} value={fk.fare_class} onChange={(e) => up("fare_class", e.target.value)}>
          {FARE_CLASSES.map((f) => (
            <option key={f} value={f}>{FARE_LABEL[f]}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
