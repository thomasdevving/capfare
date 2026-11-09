/**
 * PII-safe structured logger. Keys that could carry personal data are redacted, and
 * long strings are truncated, so .eml content or names never end up in logs.
 */
const PII_KEYS = /(email|e-?mail|last_?name|first_?name|name|booking_?ref|pnr|eml|raw|address|phone|passenger|sealed|ct)$/i;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 40) + "…[truncated]" : v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = PII_KEYS.test(k) ? "[redacted]" : redact(x, depth + 1);
    return out;
  }
  return v;
}

export function logger(service: string) {
  return (msg: string, data?: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), service, msg, ...(redact(data ?? {}) as object) }) + "\n");
  };
}
