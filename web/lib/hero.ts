/**
 * The landing-page example, computed with the same public formula as the contract
 * (`computePremium` from @capfare/shared, conformance-tested against capfare-core).
 * All inputs here are an EXAMPLE and labelled as such on the page.
 */
import { capPayout, computePremium, type Params, type PremiumInputs } from "@capfare/shared";

export const HERO = {
  /** Example airline price for the fare class, daily, from 13 days before booking to booking day (cents). */
  path: [17000, 16900, 17200, 17500, 17400, 18100, 19000, 19900, 20500, 21400, 22600, 23900, 25000, 26000],
  paid: 25500,
  current: 17000,
  defaultCap: 18000,
  minCap: 17000,
  maxCap: 26000,
  signals: { momentum_bucket: 2, availability_bucket: 1, season_flag: false },
  now: 1_800_000_000,
  departureInDays: 45,
};

export interface VaultFiguresLite {
  total_assets: string;
  locked_coverage: string;
  pending_withdrawals: string;
}

export const EXAMPLE_VAULT: VaultFiguresLite = { total_assets: "20000000000", locked_coverage: "0", pending_withdrawals: "0" };

export function heroInputs(params: Params, capCents: number, vault: VaultFiguresLite = EXAMPLE_VAULT): PremiumInputs {
  const p = params.cap;
  return {
    product: "cap",
    current_price: HERO.current,
    strike: capCents,
    signals: HERO.signals,
    now: HERO.now,
    departure_ts: HERO.now + HERO.departureInDays * 86_400,
    vault_total_assets: vault.total_assets === "0" ? EXAMPLE_VAULT.total_assets : vault.total_assets,
    vault_locked: vault.locked_coverage,
    vault_reserved: vault.pending_withdrawals,
    new_lock: (BigInt(p.max_payout) * BigInt(params.global.usdc_micro_per_cent)).toString(),
    flight_exposure: 0,
  };
}

export function heroQuote(params: Params, capCents: number, vault?: VaultFiguresLite) {
  const b = computePremium(params.cap, heroInputs(params, capCents, vault));
  const index = HERO.path[HERO.path.length - 1];
  return {
    premium: b.premium,
    payout: capPayout(index, HERO.paid, capCents, params.cap.deductible, params.cap.max_payout),
    deductible: params.cap.deductible,
    maxPayout: params.cap.max_payout,
    activationDelaySecs: params.cap.activation_delay_secs,
    breakdown: b,
  };
}

export function clampCap(c: number): number {
  return Math.round(Math.min(HERO.maxCap, Math.max(HERO.minCap, c)) / 100) * 100;
}
