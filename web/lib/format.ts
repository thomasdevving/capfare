export function eur(cents: number): string {
  const v = cents / 100;
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function usdc(micro: string | bigint, digits = 2): string {
  const v = BigInt(micro);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / 1_000_000n).toLocaleString("en-US");
  const frac = (a % 1_000_000n).toString().padStart(6, "0").slice(0, digits);
  return `${neg ? "−" : ""}${whole}${digits ? "." + frac : ""}`;
}

export function duration(secs: number): string {
  if (secs < 120) return `${secs} seconds`;
  if (secs < 7200) return `${Math.round(secs / 60)} minutes`;
  if (secs < 172800) return `${Math.round(secs / 3600)} hours`;
  return `${Math.round(secs / 86400)} days`;
}

export function clock(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function short(hex: string, n = 8): string {
  return hex.length > 2 * n ? `${hex.slice(0, n)}…${hex.slice(-4)}` : hex;
}
