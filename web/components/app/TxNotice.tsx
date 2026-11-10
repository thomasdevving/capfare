"use client";
/**
 * "Transaction confirmed · View on NearBlocks": every gasless transaction on a public network
 * links to the block explorer, so anyone can check purchases, claims, payouts and vault moves
 * themselves. Shows nothing on a local sandbox (no public explorer).
 */
import { useEffect, useState } from "react";
import { explorer, TX_EVENT, txUrl, type TxEventDetail } from "@/lib/explorer";

const WHAT: Record<string, string> = {
  buy_caps: "Price Cap bought",
  buy_drop: "Drop Guarantee bought",
  claim_cap: "Claim submitted",
  settle_drop: "Drop Guarantee settled",
  finalize_claim: "Payout sent",
  retry_payout: "Payout sent",
  refund_sold_out: "Premium refunded",
  withdraw_credit: "Credit withdrawn",
  request_withdraw: "Withdrawal requested",
  claim_withdrawal: "Withdrawal paid",
  roll_epoch: "Epoch rolled",
  faucet: "Test USDC received",
  ft_transfer_call: "Transfer confirmed",
};

export default function TxNotice() {
  const [txs, setTxs] = useState<TxEventDetail[]>([]);
  useEffect(() => {
    if (!explorer()) return;
    const on = (e: Event) => setTxs((t) => [(e as CustomEvent<TxEventDetail>).detail, ...t].slice(0, 3));
    window.addEventListener(TX_EVENT, on);
    return () => window.removeEventListener(TX_EVENT, on);
  }, []);
  if (!txs.length) return null;
  return (
    <div className="tx-notice" role="status" aria-live="polite">
      {txs.map((t) => (
        <p key={t.hash}>
          <span>{WHAT[t.method] ?? "Transaction confirmed"} on NEAR testnet.</span>{" "}
          <a href={txUrl(t.hash)} target="_blank" rel="noopener">View on NearBlocks ↗</a>
          <button className="tx-x" aria-label="Dismiss" onClick={() => setTxs((x) => x.filter((y) => y.hash !== t.hash))}>×</button>
        </p>
      ))}
    </div>
  );
}
