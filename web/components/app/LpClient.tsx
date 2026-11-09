"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Policy, VaultState } from "@capfare/shared";
import { gasless } from "@/lib/wallet";
import { dateTime, eur, short, usdc } from "@/lib/format";
import LineChart from "./LineChart";
import { errText, getJson, Msg, useSession } from "./ui";

interface Epoch {
  epoch: number;
  ended_at: number;
  total_assets: string;
  total_shares: string;
  share_price_e6: string;
  deposits: string;
  withdrawals: string;
  premiums_earned: string;
  payouts: string;
  locked_coverage: string;
}
interface Lp {
  vault_id: string;
  token: string;
  history: Epoch[];
  queues: [{ account_id: string; amount: string }[], { account_id: string; shares: string; reserved: string }[]];
  mine: { shares: string; value: string; claimable: string; wallet: string } | null;
}
interface Overview {
  vaults: { cap: VaultState; drop: VaultState };
  activePolicies: Policy[];
  networkLabel: string;
  updatedAt: number;
}

export default function LpClient() {
  const s = useSession();
  const [which, setWhich] = useState<"cap" | "drop">("cap");
  const [lp, setLp] = useState<Lp | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("100");
  const [pct, setPct] = useState("50");

  const load = useCallback(() => {
    getJson<Lp>(`/api/lp?vault=${which}${s ? `&account=${s.accountId}` : ""}`).then(setLp).catch((e) => setErr(errText(e)));
    getJson<Overview>("/api/overview").then(setO).catch((e) => setErr(errText(e)));
  }, [which, s]);
  useEffect(() => {
    load();
  }, [load]);

  const v = o?.vaults[which];
  const policies = useMemo(() => (o?.activePolicies ?? []).filter((p) => p.product === which), [o, which]);
  const byFlight = useMemo(() => group(policies, (p) => `${p.flight_key.flight_number} ${p.flight_key.departure_date} ${p.flight_key.fare_class}`), [policies]);
  const byRouteWeek = useMemo(
    () => group(policies, (p) => `${p.flight_key.origin}→${p.flight_key.destination}, week of ${new Date(Math.floor(p.departure_ts / 604800) * 604800 * 1000).toISOString().slice(0, 10)}`),
    [policies],
  );
  const epochs = lp?.history ?? [];
  const worst = [...epochs].map((e) => ({ e, pnl: BigInt(e.premiums_earned) - BigInt(e.payouts) })).sort((a, b) => (a.pnl < b.pnl ? -1 : 1)).slice(0, 5);

  async function run(label: string, f: () => Promise<string>) {
    setBusy(label);
    setErr(null);
    setOk(null);
    try {
      setOk(await f());
      load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="btn-row" role="radiogroup" aria-label="Vault">
        <button role="radio" aria-checked={which === "cap"} className={`btn ${which === "cap" ? "btn-primary" : ""}`} onClick={() => setWhich("cap")}>Price Cap vault</button>
        <button role="radio" aria-checked={which === "drop"} className={`btn ${which === "drop" ? "btn-primary" : ""}`} onClick={() => setWhich("drop")}>Drop Guarantee vault</button>
      </div>
      <Msg kind="info">You can lose money as an LP: payouts reduce the vault. Deposits and withdrawals are processed at the next epoch, not instantly. {o ? `Network: ${o.networkLabel}.` : ""}</Msg>
      {err ? <Msg kind="error">{err}</Msg> : null}
      {ok ? <Msg kind="ok">{ok}</Msg> : null}

      {v ? (
        <section className="card">
          <h2 style={{ fontSize: "var(--s4)" }}>{v.name} <span className="small muted mono-wrap">{lp?.vault_id}</span></h2>
          <table className="data" style={{ maxWidth: 640 }}>
            <tbody>
              <tr><th>Total assets</th><td className="r num">{usdc(v.total_assets)} tUSDC</td></tr>
              <tr><th>Locked coverage</th><td className="r num">{usdc(v.locked_coverage)} tUSDC</td></tr>
              <tr><th>Pending withdrawals (reserved)</th><td className="r num">{usdc(v.pending_withdrawals)} tUSDC</td></tr>
              <tr><th>Free liquidity</th><td className="r num">{usdc(v.free_liquidity)} tUSDC</td></tr>
              <tr><th>Pending deposits</th><td className="r num">{usdc(v.pending_deposits)} tUSDC</td></tr>
              <tr><th>Unearned premiums (not LP assets yet)</th><td className="r num">{usdc(v.unearned_premiums)} tUSDC</td></tr>
              <tr><th>Share price</th><td className="r num">{(Number(v.share_price_e6) / 1e6).toFixed(6)} tUSDC</td></tr>
              <tr><th>Premiums earned / payouts (all time)</th><td className="r num">{usdc(v.premiums_earned_total)} / {usdc(v.payouts_total)}</td></tr>
              <tr><th>Epoch</th><td className="r">#{v.epoch}, next at {dateTime(v.next_epoch_at)}</td></tr>
              <tr><th>Solvency check</th><td className={`r ${v.invariant_ok ? "pass" : "fail"}`}>{v.invariant_ok ? "Passed" : "Failed"}</td></tr>
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Share price by epoch</h2>
        <LineChart points={epochs.map((e) => ({ x: `#${e.epoch}`, y: Number(e.share_price_e6) / 1e6 }))} label="Share price" format={(x) => x.toFixed(4)} />
        <h3 style={{ fontSize: "var(--s3)", marginTop: 16 }}>Premiums vs payouts</h3>
        <table className="data">
          <thead><tr><th>Epoch</th><th>Ended</th><th className="r">Premiums earned</th><th className="r">Payouts</th><th className="r">Deposits</th><th className="r">Withdrawals</th></tr></thead>
          <tbody>
            {epochs.slice(-12).reverse().map((e) => (
              <tr key={e.epoch}><td>#{e.epoch}</td><td>{dateTime(e.ended_at)}</td><td className="r num">{usdc(e.premiums_earned)}</td><td className="r num">{usdc(e.payouts)}</td><td className="r num">{usdc(e.deposits)}</td><td className="r num">{usdc(e.withdrawals)}</td></tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ fontSize: "var(--s3)", marginTop: 16 }}>Worst epochs</h3>
        <table className="data">
          <thead><tr><th>Epoch</th><th className="r">Premiums − payouts</th></tr></thead>
          <tbody>
            {worst.map(({ e, pnl }) => (
              <tr key={e.epoch}><td>#{e.epoch}</td><td className={`r num ${pnl < 0n ? "fail" : ""}`}>{usdc(pnl)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Exposure</h2>
        <ExposureTable title="By flight" rows={byFlight} />
        <ExposureTable title="By route and departure week" rows={byRouteWeek} />
      </section>

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Your position</h2>
        {!s ? (
          <p><a href="/account">Create an account</a> to deposit.</p>
        ) : lp?.mine ? (
          <>
            <p className="num">Shares: {short(lp.mine.shares, 12)} · value {usdc(lp.mine.value)} tUSDC · claimable {usdc(lp.mine.claimable)} tUSDC · wallet {usdc(lp.mine.wallet)} tUSDC</p>
            <label htmlFor="dep">Deposit (tUSDC, processed at the next epoch)</label>
            <input id="dep" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => run("dep", async () => {
                const micro = BigInt(Math.round(Number(amount) * 1e6));
                await gasless(lp.token, "ft_transfer_call", { receiver_id: lp.vault_id, amount: micro.toString(), msg: '"deposit"' }, 1n);
                return `Deposit of ${amount} tUSDC queued for the next epoch.`;
              })}>Queue deposit</button>
            </div>
            <label htmlFor="pct">Withdraw (% of your shares)</label>
            <input id="pct" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn" disabled={!!busy || lp.mine.shares === "0"} onClick={() => run("wd", async () => {
                const sh = (BigInt(lp.mine!.shares) * BigInt(Math.min(100, Math.max(1, Number(pct))))) / 100n;
                await gasless(lp.vault_id, "request_withdraw", { shares: sh.toString() });
                return "Withdrawal queued; its value is reserved now and paid at the next epoch.";
              })}>Request withdrawal</button>
              <button className="btn" disabled={!!busy || lp.mine.claimable === "0"} onClick={() => run("claim", async () => {
                await gasless(lp.vault_id, "claim_withdrawal", {});
                return "Withdrawal sent to your wallet.";
              })}>Claim processed withdrawal</button>
              <button className="btn" disabled={!!busy || !v || Date.now() / 1000 < v.next_epoch_at} onClick={() => run("roll", async () => {
                await gasless(lp.vault_id, "roll_epoch", {});
                return "Epoch rolled.";
              })}>Roll epoch (anyone can)</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function group(ps: Policy[], key: (p: Policy) => string) {
  const m = new Map<string, { n: number; max: number }>();
  for (const p of ps) {
    const k = key(p);
    const e = m.get(k) ?? { n: 0, max: 0 };
    e.n++;
    e.max += p.max_payout_minor;
    m.set(k, e);
  }
  return [...m.entries()].sort((a, b) => b[1].max - a[1].max);
}

function ExposureTable({ title, rows }: { title: string; rows: [string, { n: number; max: number }][] }) {
  return (
    <>
      <h3 style={{ fontSize: "var(--s3)", marginTop: 12 }}>{title}</h3>
      {rows.length ? (
        <table className="data">
          <thead><tr><th>{title.replace("By ", "")}</th><th className="r">Active policies</th><th className="r">Max payouts</th></tr></thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="r num">{v.n}</td><td className="r num">{eur(v.max)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">No active policies.</p>
      )}
    </>
  );
}
