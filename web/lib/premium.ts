import { computePremium, type Params, type SnapshotRecord, type VaultState } from "@capfare/shared";

/** The on-chain inputs a quote needs (see lib/quote.ts). Safe to use in the browser. */
export interface PremiumQuote {
  snapshot: SnapshotRecord;
  vault: VaultState;
  params: Params;
  exposure: [number, number];
  now: number;
}

/**
 * Premium for all seats, exactly as the contract prices it (purchase.rs build_policy): the
 * per-traveller formula sees the whole policy's lock and the other seats as flight exposure.
 * `extraLock`: coverage already locked by an earlier leg of the same purchase (micro-USDC).
 */
export function premiumFor(q: PremiumQuote, product: "cap" | "drop", strike: number, seats = 1, extraLock = 0n) {
  const pp = q.params[product];
  const lock = BigInt(pp.max_payout) * BigInt(seats) * BigInt(q.params.global.usdc_micro_per_cent);
  const b = computePremium(pp, {
    product,
    current_price: q.snapshot.price_minor,
    strike,
    signals: q.snapshot.signals,
    now: q.now,
    departure_ts: q.snapshot.departure_ts,
    vault_total_assets: q.vault.total_assets,
    vault_locked: (BigInt(q.vault.locked_coverage) + extraLock).toString(),
    vault_reserved: q.vault.pending_withdrawals,
    new_lock: lock.toString(),
    flight_exposure: q.exposure[0] + pp.max_payout * (seats - 1),
  });
  return { ...b, per_seat: b.premium, premium: b.premium * seats, lock };
}

/** What the user signs as the highest premium: a small margin for price moves before confirmation. */
export const maxPremium = (premium: number) => premium + Math.max(10, Math.ceil(premium * 0.03));
