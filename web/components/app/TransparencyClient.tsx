"use client";
import { coverageLabel, coverageRoute } from "@capfare/shared";
import { useEffect, useState } from "react";
import type { Params, ProductParams } from "@capfare/shared";
import { dateTime, duration, eur, short, usdc } from "@/lib/format";
import type { Overview } from "@/lib/chain";
import { errText, getJson, Msg } from "./ui";
import Addr from "./Addr";

export default function TransparencyClient() {
  const [o, setO] = useState<(Overview & { networkLabel: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJson<Overview & { networkLabel: string }>("/api/overview").then(setO).catch((e) => setErr(errText(e)));
  }, []);
  if (err) return <Msg kind="error">We couldn&apos;t load live contract data: {err}</Msg>;
  if (!o) return <p>Loading live contract data…</p>;
  const now = Math.floor(Date.now() / 1000);

  return (
    <div>
      <p className="small muted">
        Network: {o.networkLabel}. Read from the contracts at {dateTime(o.updatedAt)}. Registry <Addr id={o.contracts.registry} />, vaults <Addr id={o.contracts.capVault} /> and <Addr id={o.contracts.dropVault} />, attestations <Addr id={o.contracts.attestation} />, token <Addr id={o.contracts.token} />.
        {o.networkLabel === "NEAR testnet" ? " Each address opens on NearBlocks, the public NEAR explorer, with every purchase, claim and payout." : ""}
      </p>

      <section className="card" aria-labelledby="coll">
        <h2 id="coll" style={{ fontSize: "var(--s4)" }}>Full collateralisation</h2>
        <table className="data">
          <thead><tr><th>Vault</th><th className="r">Total assets</th><th className="r">Locked coverage</th><th className="r">Pending withdrawals</th><th className="r">Slack</th><th>Check</th></tr></thead>
          <tbody>
            {(["cap", "drop"] as const).map((k) => {
              const v = o.vaults[k];
              const slack = BigInt(v.total_assets) - BigInt(v.locked_coverage) - BigInt(v.pending_withdrawals);
              return (
                <tr key={k}>
                  <td>{v.name}</td>
                  <td className="r num">{usdc(v.total_assets)}</td>
                  <td className="r num">{usdc(v.locked_coverage)}</td>
                  <td className="r num">{usdc(v.pending_withdrawals)}</td>
                  <td className="r num">{usdc(slack)}</td>
                  <td className={v.invariant_ok ? "pass" : "fail"}>{v.invariant_ok ? "total_assets ≥ locked + pending ✓" : "VIOLATED"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted">Every policy&apos;s maximum payout is locked when it is sold; a sale is refused if free liquidity is too small. Premiums only count as LP assets once a policy ends.</p>
      </section>

      <section className="card" aria-labelledby="formulas">
        <h2 id="formulas" style={{ fontSize: "var(--s4)" }}>Payout and premium formulas</h2>
        <p><strong>Price Cap payout</strong> = the lower of the airline&apos;s price when you booked and what you paid, minus your cap, minus the deductible; never below zero and never above the maximum payout.</p>
        <p><strong>Drop Guarantee payout</strong> = what you paid minus the lowest airline price seen during the 7-day window, minus the deductible; never below zero and never above the maximum payout.</p>
        <p><strong>Premium</strong> = base price from the table (by ticket price and days to departure) × momentum multiplier × seat-availability multiplier × season multiplier × vault-utilisation multiplier × cap-distance adjustment, rounded up to the cent and kept between the minimum and maximum premium. It is computed on-chain from the latest signed price snapshot (at most {duration(o.params.global.max_quote_snapshot_age_secs)} old).</p>
        <p className="small muted">Settlement: 1 EUR cent = {o.params.global.usdc_micro_per_cent} micro-USDC (fixed per policy at purchase). Protocol fee {o.params.global.protocol_fee_bps / 100}% of earned premiums. Parameter changes wait {duration(o.params.global.param_timelock_secs)}.</p>
      </section>

      <section className="card" aria-labelledby="pending">
        <h2 id="pending" style={{ fontSize: "var(--s4)" }}>Pending parameter changes</h2>
        {o.pendingParams ? (
          <p>
            New parameters published {dateTime(o.pendingParams.proposed_at)}; they can be applied from {dateTime(o.pendingParams.apply_after)}
            {o.pendingParams.apply_after > now ? ` (in ${duration(o.pendingParams.apply_after - now)})` : " (anyone can apply them now)"}.
          </p>
        ) : (
          <p>None.</p>
        )}
      </section>

      <ParamsTable title="Price Cap parameters" p={o.params.cap} pending={o.pendingParams?.params.cap} />
      <ParamsTable title="Drop Guarantee parameters" p={o.params.drop} pending={o.pendingParams?.params.drop} />
      <GlobalTable g={o.params.global} />

      <section className="card" aria-labelledby="keys">
        <h2 id="keys" style={{ fontSize: "var(--s4)" }}>Registered service keys</h2>
        {o.keys.some(([, v]) => v.dev && !v.revoked) ? (
          <Msg kind="info">
            <strong>Not running in a TEE yet.</strong> The price oracle and booking verifier on this deployment sign with development keys: the same code that is built to run in an Intel TDX confidential VM (dstack), but here it runs on CapFare&apos;s server, so you trust that server. Their keys went through the same timelocked registration an enclave key would; a hardware deployment would show a TDX measurement below instead.
          </Msg>
        ) : null}
        <p className="small muted">
          Demo price sources {o.attestationConfig.allow_demo_sources ? "ARE accepted on this deployment (demo)" : "are rejected on this deployment"}. New keys wait {duration(o.attestationConfig.key_timelock_secs)} after being published.
        </p>
        <table className="data">
          <thead><tr><th>Service</th><th>Signing key</th><th>Measurement</th><th>Report hash</th><th>Registered</th><th>Runs in</th><th>Status</th></tr></thead>
          <tbody>
            {o.keys.map(([k, v]) => (
              <tr key={k}>
                <td>{v.service.replace("_", " ")}</td>
                <td className="mono-wrap" title={k}>{short(k)}</td>
                <td className="mono-wrap" title={v.measurement}>{short(v.measurement)}</td>
                <td className="mono-wrap" title={v.report_hash}>{short(v.report_hash)}</td>
                <td>{dateTime(v.registered_at)}</td>
                <td>{v.dev ? "Development key (no TEE)" : "TEE measurement"}</td>
                <td className={v.revoked ? "fail" : "pass"}>{v.revoked ? "revoked" : "active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.pendingKeys.length ? <p className="small">Pending keys: {o.pendingKeys.map(([k, v]) => `${v.service} ${short(k)} from ${dateTime(v.apply_after)}`).join("; ")}</p> : null}
      </section>

      <section className="card" aria-labelledby="fresh">
        <h2 id="fresh" style={{ fontSize: "var(--s4)" }}>Oracle freshness per active flight</h2>
        <table className="data">
          <thead><tr><th>Flight</th><th className="r">Policies</th><th className="r">Latest price</th><th className="r">Age</th><th>Source</th></tr></thead>
          <tbody>
            {Object.values(
              o.activePolicies.reduce<Record<string, { key: string; h: string; n: number }>>((m, p) => {
                const k = `${coverageLabel(p.coverage)} ${coverageRoute(p.coverage).fare_class}`;
                m[p.flight_key_hash] = { key: k, h: p.flight_key_hash, n: (m[p.flight_key_hash]?.n ?? 0) + 1 };
                return m;
              }, {}),
            ).map((f) => {
              const s = o.flights.find((x) => x.flight_key_hash === f.h)?.latest;
              return (
                <tr key={f.h}>
                  <td>{f.key}</td>
                  <td className="r num">{f.n}</td>
                  <td className="r num">{s ? eur(s.price_minor) : "—"}</td>
                  <td className="r">{s ? duration(Math.max(0, now - s.observed_at)) : "no snapshot"}</td>
                  <td>{s ? (s.demo ? "demo (scripted)" : "airline") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {o.activePolicies.length === 0 ? <p className="muted small">No active policies.</p> : null}
      </section>
    </div>
  );
}

function ParamsTable({ title, p, pending }: { title: string; p: ProductParams; pending?: ProductParams }) {
  const rows: [string, string, string?][] = [
    ["Deductible", eur(p.deductible), pending && eur(pending.deductible)],
    ["Maximum payout", eur(p.max_payout), pending && eur(pending.max_payout)],
    ["Premium range", `${eur(p.min_premium)} – ${eur(p.max_premium)}`],
    ["Validity", duration(p.validity_secs)],
    ["Activation delay", duration(p.activation_delay_secs)],
    ["Per-flight exposure cap", eur(p.flight_exposure_cap)],
    ["Per-route-week exposure cap", eur(p.route_week_exposure_cap)],
    ["Per user: per flight / per day", `${p.max_per_user_per_flight} / ${p.max_per_user_per_day}`],
    ["Momentum multipliers (falling → rising)", p.momentum_mult_bps.map((x) => (x / 1e4).toFixed(2)).join(" · ")],
    ["Seat-availability multipliers (open → nearly full)", p.availability_mult_bps.map((x) => (x / 1e4).toFixed(2)).join(" · ")],
    ["Season multiplier", (p.season_mult_bps / 1e4).toFixed(2)],
    ["Cap distance: −% premium per % above price, floor", `${(p.moneyness_slope_bps / 1e4).toFixed(2)}, ${(p.moneyness_floor_bps / 1e4).toFixed(2)}`],
    ["Utilisation surcharge above", `${p.util_kink_bps / 100}%`],
  ];
  return (
    <section className="card">
      <h2 style={{ fontSize: "var(--s4)" }}>{title}</h2>
      <table className="data">
        <tbody>
          {rows.map(([k, v, pv]) => (
            <tr key={k}><th>{k}</th><td className="num">{v}{pv && pv !== v ? <span className="muted"> → {pv} (pending)</span> : null}</td></tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ fontSize: "var(--s3)", marginTop: 12 }}>Base premium table</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Ticket price \ days to departure</th>
            {[0, ...p.dtd_bucket_bounds].map((d, i) => (
              <th key={i} className="r">{i < p.dtd_bucket_bounds.length ? `${d}–${p.dtd_bucket_bounds[i] - 1}` : `${d}+`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.base_table.map((row, i) => (
            <tr key={i}>
              <th>{i === 0 ? `under ${eur(p.price_bucket_bounds[0])}` : i < p.price_bucket_bounds.length ? `${eur(p.price_bucket_bounds[i - 1])}–${eur(p.price_bucket_bounds[i])}` : `${eur(p.price_bucket_bounds[i - 1])}+`}</th>
              {row.map((c, j) => (
                <td key={j} className="r num">{eur(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GlobalTable({ g }: { g: Params["global"] }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: "var(--s4)" }}>Rules for prices and claims</h2>
      <table className="data">
        <tbody>
          <tr><th>Price snapshot for a quote at most</th><td>{duration(g.max_quote_snapshot_age_secs)} old</td></tr>
          <tr><th>Price snapshot used for a cap payout at most</th><td>{duration(g.max_index_snapshot_age_secs)} before booking</td></tr>
          <tr><th>Booking check at most</th><td>{duration(g.max_attestation_age_secs)} old</td></tr>
          <tr><th>Final check for refundable tickets</th><td>{duration(g.final_check_lead_secs)} before departure</td></tr>
          <tr><th>Claims accepted until</th><td>{duration(g.claim_grace_secs)} after expiry</td></tr>
          <tr><th>Sold-out premium refund</th><td>{g.sold_out_premium_refund ? "on" : "off"}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
