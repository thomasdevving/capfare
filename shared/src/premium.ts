/** BigInt port of contracts/core/src/premium.rs — must match bit-for-bit. */
import type { PremiumBreakdown, PremiumInputs, ProductParams } from "./types.ts";

const BPS = 10_000n;

export class PremiumError extends Error {}

export function bucket(v: number, bounds: number[]): number {
  let n = 0;
  for (const b of bounds) {
    if (v >= b) n++;
    else break;
  }
  return n;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export function utilizationMultBps(p: ProductParams, utilBps: bigint, flightRatioBps: bigint): bigint {
  const over = max(0n, utilBps - BigInt(p.util_kink_bps));
  return BPS + (BigInt(p.util_slope_bps) * over) / BPS + (BigInt(p.flight_slope_bps) * flightRatioBps) / BPS;
}

export function moneynessMultBps(p: ProductParams, product: string, price: number, strike: number): bigint {
  if (product === "drop") return BPS;
  const otm = (BigInt(Math.max(0, strike - price)) * BPS) / BigInt(price);
  const dec = (otm * BigInt(p.moneyness_slope_bps)) / BPS;
  const adj = max(0n, BPS - dec);
  return max(adj, BigInt(p.moneyness_floor_bps));
}

/** Multiplier for the buyer's choices: deductible, cover duration, flexible route cover. */
export function optionsMultBps(p: ProductParams, i: PremiumInputs) {
  const deductible = i.deductible ?? p.deductible;
  const validity = i.validity_secs ?? p.validity_secs;
  const di = p.deductible_options.indexOf(deductible);
  if (di < 0) throw new PremiumError("choose one of the offered deductibles");
  const vi = p.validity_options_secs.indexOf(validity);
  if (vi < 0) throw new PremiumError("choose one of the offered cover durations");
  const ded = BigInt(p.deductible_mult_bps[di]);
  const dur = BigInt(p.validity_mult_bps[vi]);
  let flex = BPS;
  if (i.route_window_days !== undefined && i.route_window_days !== null) {
    if (i.route_window_days >= p.flex_window_mult_bps.length) throw new PremiumError("date window must be 0 to 3 days");
    const group = i.airport_group ? BigInt(p.airport_group_mult_bps) : BPS;
    flex = (BigInt(p.flex_window_mult_bps[i.route_window_days]) * group) / BPS;
  }
  const opt = (((ded * dur) / BPS) * flex) / BPS;
  return { ded, dur, flex, opt, deductible, validity };
}

export function computePremium(p: ProductParams, i: PremiumInputs): PremiumBreakdown {
  if (i.current_price === 0) throw new PremiumError("price must be positive");
  if (i.departure_ts <= i.now) throw new PremiumError("flight has departed");
  if (i.departure_ts - i.now < p.min_secs_before_departure) throw new PremiumError("too close to departure");
  if (i.product === "cap" && i.strike < i.current_price) throw new PremiumError("cap must be at or above the current price");
  const total = BigInt(i.vault_total_assets);
  if (total === 0n) throw new PremiumError("vault has no assets");
  const days = Math.floor((i.departure_ts - i.now) / 86_400);
  const pb = bucket(i.current_price, p.price_bucket_bounds);
  const db = bucket(days, p.dtd_bucket_bounds);
  const base = BigInt(p.base_table[pb][db]);
  const mom = BigInt(p.momentum_mult_bps[Math.min(i.signals.momentum_bucket, 4)]);
  const av = BigInt(p.availability_mult_bps[Math.min(i.signals.availability_bucket, 4)]);
  const season = i.signals.season_flag ? BigInt(p.season_mult_bps) : BPS;
  const used = BigInt(i.vault_locked) + BigInt(i.vault_reserved) + BigInt(i.new_lock);
  const utilBps = min((used * BPS) / total, 1_000_000n);
  const flightRatio = min(
    ((BigInt(i.flight_exposure) + BigInt(p.max_payout)) * BPS) / max(BigInt(p.flight_exposure_cap), 1n),
    1_000_000n,
  );
  const util = utilizationMultBps(p, utilBps, flightRatio);
  const money = moneynessMultBps(p, i.product, i.current_price, i.strike);
  const o = optionsMultBps(p, i);
  const num = base * mom * av * season * util * money * o.opt;
  const den = BPS ** 6n;
  const unclamped = num / den + (num % den !== 0n ? 1n : 0n);
  const premium = min(max(unclamped, BigInt(p.min_premium)), BigInt(p.max_premium));
  return {
    premium: Number(premium),
    unclamped: Number(unclamped),
    base: Number(base),
    price_bucket: pb,
    dtd_bucket: db,
    days_to_departure: days,
    momentum_mult_bps: Number(mom),
    availability_mult_bps: Number(av),
    season_mult_bps: Number(season),
    utilization_mult_bps: Number(util),
    moneyness_mult_bps: Number(money),
    utilization_bps: Number(utilBps),
    flight_exposure_ratio_bps: Number(flightRatio),
    deductible_mult_bps: Number(o.ded),
    validity_mult_bps: Number(o.dur),
    flex_mult_bps: Number(o.flex),
    options_mult_bps: Number(o.opt),
    deductible: o.deductible,
    validity_secs: o.validity,
    max_payout: p.max_payout,
  };
}

/** Price Cap: clamp(min(index, paid) − strike − deductible, 0, max_payout). */
export function capPayout(index: number, paid: number, strike: number, deductible: number, maxPayout: number): number {
  return Math.min(Math.max(Math.min(index, paid) - strike - deductible, 0), maxPayout);
}

/** Drop Guarantee: clamp(paid − lowest − deductible, 0, max_payout). */
export function dropPayout(paid: number, lowest: number, deductible: number, maxPayout: number): number {
  return Math.min(Math.max(paid - lowest - deductible, 0), maxPayout);
}

/** Coverage lock in micro-USDC (rounded up, like the contract). */
export function lockUsdc(maxPayoutCents: number, usdcMicroPerCent: number): bigint {
  return BigInt(maxPayoutCents) * BigInt(usdcMicroPerCent);
}

export function formatEur(cents: number, locale = "en"): string {
  return new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatUsdc(micro: string | bigint, digits = 2): string {
  const v = BigInt(micro);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").slice(0, digits);
  return `${whole.toLocaleString("en-US")}${digits ? "." + frac : ""}`;
}
