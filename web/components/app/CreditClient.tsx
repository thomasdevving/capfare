"use client";
import { useCallback, useEffect, useState } from "react";
import type { Policy } from "@capfare/shared";
import { coverageLabel } from "@capfare/shared";
import { gasless } from "@/lib/wallet";
import { eur, usdc } from "@/lib/format";
import { errText, getJson, Msg, postJson, SignInFirst, useSession } from "./ui";

interface Data {
  policies: Policy[];
  credit: string;
  wallet: string;
}

export default function CreditClient({ registry, token, tokenIsMock }: { registry: string; token: string; tokenIsMock: boolean }) {
  const s = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [topup, setTopup] = useState(2000);
  const [withdraw, setWithdraw] = useState("10");
  const [iban, setIban] = useState("");
  const [ibanAmt, setIbanAmt] = useState("10");
  const [dest, setDest] = useState("nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near");
  const [dests, setDests] = useState<{ id: string; label: string }[]>([]);
  const [quote, setQuote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (s) getJson<Data>(`/api/policies?account=${s.accountId}`).then(setD).catch((e) => setErr(errText(e)));
  }, [s]);
  useEffect(() => {
    load();
    getJson<{ destinations: { id: string; label: string }[] }>("/api/intents/quote").then((j) => setDests(j.destinations)).catch(() => {});
  }, [load]);

  if (s === undefined) return null;
  if (s === null) return <SignInFirst />;

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
  const micro = (eurStr: string) => BigInt(Math.round(Number(eurStr.replace(",", ".")) * 1_000_000));
  const payouts = (d?.policies ?? []).filter((p) => p.payout_minor && p.state === "paid_out");

  return (
    <div>
      <div className="grid2">
        <div className="card">
          <h2 style={{ fontSize: "var(--s4)" }}>Credit</h2>
          <p className="num" style={{ fontSize: "var(--s5)", fontWeight: 700 }}>{d ? usdc(d.credit) : "…"} tUSDC</p>
          <p className="small muted">Premiums are paid from your credit, so you don&apos;t pay card or bank fees on every small premium.</p>
        </div>
        <div className="card">
          <h2 style={{ fontSize: "var(--s4)" }}>Wallet</h2>
          <p className="num" style={{ fontSize: "var(--s5)", fontWeight: 700 }}>{d ? usdc(d.wallet) : "…"} tUSDC</p>
          <p className="small muted">Payouts arrive here. Test USDC has no value.</p>
        </div>
      </div>
      {err ? <Msg kind="error">{err}</Msg> : null}
      {ok ? <Msg kind="ok">{ok}</Msg> : null}

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Top up</h2>
        <div className="btn-row">
          {[1000, 2000, 5000].map((c) => (
            <button key={c} className={`btn ${topup === c ? "btn-primary" : ""}`} aria-pressed={topup === c} onClick={() => setTopup(c)}>{eur(c)}</button>
          ))}
        </div>
        <p className="small muted">Pay with iDEAL or card through a licensed payment partner. On testnet this is simulated: no money moves and you receive test USDC.</p>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run("topup", async () => {
          const r = await postJson<{ usdcMicro: string; simulated: boolean }>("/api/ramp/topup", { account_id: s.accountId, amount_eur_cents: topup, method: "ideal" });
          return `Added ${usdc(r.usdcMicro)} tUSDC to your credit (simulated iDEAL payment).`;
        })}>{busy === "topup" ? "Processing…" : `Top up ${eur(topup)} (simulated iDEAL)`}</button>
        {tokenIsMock ? (
          <p className="small" style={{ marginTop: 12 }}>
            Or get free test USDC from the faucet:{" "}
            <button className="btn" disabled={!!busy} onClick={() => run("faucet", async () => {
              await gasless(token, "faucet", {});
              return "100 test USDC added to your wallet.";
            })}>Faucet</button>{" "}
            <button className="btn" disabled={!!busy || !d || BigInt(d.wallet) < 20_000_000n} onClick={() => run("move", async () => {
              await gasless(token, "ft_transfer_call", { receiver_id: registry, amount: "20000000", msg: '"top_up"' }, 1n);
              return "Moved 20 tUSDC from your wallet to your credit.";
            })}>Move 20 tUSDC to credit</button>
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Withdraw</h2>
        <label htmlFor="wd">Unused credit to your wallet (tUSDC)</label>
        <input id="wd" inputMode="decimal" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <button className="btn" disabled={!!busy} onClick={() => run("wd", async () => {
            await gasless(registry, "withdraw_credit", { amount: micro(withdraw).toString() });
            return `Moved ${withdraw} tUSDC to your wallet.`;
          })}>Withdraw credit</button>
        </div>
        <label htmlFor="iban">To your bank account (IBAN)</label>
        <input id="iban" value={iban} onChange={(e) => setIban(e.target.value)} autoComplete="off" placeholder="NL00 BANK 0123 4567 89" />
        <label htmlFor="ibanamt">Amount (tUSDC)</label>
        <input id="ibanamt" inputMode="decimal" value={ibanAmt} onChange={(e) => setIbanAmt(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <button className="btn" disabled={!!busy || !iban} onClick={() => run("iban", async () => {
            const r = await postJson<{ message: string; status: string }>("/api/ramp/payout", { account_id: s.accountId, amount_usdc_micro: micro(ibanAmt).toString(), iban });
            return r.message;
          })}>Pay out to IBAN (simulated)</button>
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Receive another asset</h2>
        <p className="small muted">Quotes come from NEAR Intents. Intents has no testnet, so these are dry-run mainnet quotes: they show what you would receive, and nothing is sent.</p>
        <label htmlFor="dest">Receive as</label>
        <select id="dest" value={dest} onChange={(e) => setDest(e.target.value)}>
          {dests.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <div style={{ marginTop: 8 }}>
          <button className="btn" disabled={!!busy || !d} onClick={() => run("intents", async () => {
            const amt = d && BigInt(d.wallet) > 0n ? d.wallet : "10000000";
            const r = await postJson<{ quote: { amountInFormatted: string; amountOutFormatted: string; timeEstimate: number } }>("/api/intents/quote", { amount_usdc_micro: amt, destination: dest });
            const label = dests.find((x) => x.id === dest)?.label;
            setQuote(`${r.quote.amountInFormatted} USDC ≈ ${Number(r.quote.amountOutFormatted).toPrecision(6)} ${label} in about ${r.quote.timeEstimate}s (dry quote).`);
            return "Quote received.";
          })}>Get a dry quote</button>
        </div>
        {quote ? <p className="num" style={{ marginTop: 8 }}>{quote}</p> : null}
      </section>

      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Payout history</h2>
        {payouts.length ? (
          <table className="data">
            <thead><tr><th>Policy</th><th>Flight</th><th className="r">Payout</th></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}><td>#{p.id} {p.product === "cap" ? "Price Cap" : "Drop Guarantee"}</td><td>{coverageLabel(p.coverage)}</td><td className="r num">{eur(p.payout_minor ?? 0)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No payouts yet.</p>
        )}
      </section>
    </div>
  );
}
