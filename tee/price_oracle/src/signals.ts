/** Signal buckets computed from the oracle's own observation history. */
export interface Obs {
  t: number;
  price_minor: number;
  available: boolean;
}

/** 0..4 from the price change over the last 24–72h (2 = flat). Same thresholds as the backtest. */
export function momentumBucket(history: Obs[], now: number, price: number): number {
  const lookback = history.filter((o) => o.t <= now - 24 * 3600 && o.t >= now - 72 * 3600 && o.available);
  const ref = lookback.length ? lookback[lookback.length - 1] : history.find((o) => o.available);
  if (!ref || ref.price_minor <= 0) return 2;
  const r = price / ref.price_minor - 1;
  const th = [-0.08, -0.02, 0.02, 0.08];
  let b = 0;
  while (b < th.length && r >= th[b]) b++;
  return b;
}

/** 0..4 from fare-class closures / seat signals. */
export function availabilityBucket(lowerClosed?: number, seatsLeft?: number): number {
  let b = Math.min(4, Math.max(0, lowerClosed ?? 0));
  if (seatsLeft !== undefined) {
    if (seatsLeft <= 2) b = Math.max(b, 4);
    else if (seatsLeft <= 5) b = Math.max(b, 3);
    else if (seatsLeft <= 9) b = Math.max(b, 2);
  }
  return b;
}

/** Peak months for European leisure routes (Jun–Aug, late Dec). */
export function seasonFlag(departureTs: number): boolean {
  const d = new Date(departureTs * 1000);
  const m = d.getUTCMonth() + 1;
  return m === 6 || m === 7 || m === 8 || (m === 12 && d.getUTCDate() >= 18);
}
