/** Token bucket per key (e.g. per airline host or per client IP). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private refillPerSec: number) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }

  /** Waits until a token is available (for outbound fetches). */
  async wait(key: string): Promise<void> {
    while (!this.take(key)) await new Promise((r) => setTimeout(r, Math.ceil(1000 / this.refillPerSec)));
  }
}

/** Header the CapFare web app sets with the visitor's address when it calls a service. */
export const CLIENT_HEADER = "x-capfare-client";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * The address to rate-limit by. Services sit behind the web app in the same container, so every
 * request arrives from loopback: there the web app's CLIENT_HEADER names the real visitor. Any
 * other caller is limited by its own socket address and cannot pick a key through headers.
 */
export function clientKey(req: { headers?: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const remote = req.socket.remoteAddress ?? "?";
  const h = req.headers?.[CLIENT_HEADER];
  const fwd = (Array.isArray(h) ? h[0] : h)?.trim();
  return LOOPBACK.has(remote) && fwd ? fwd.slice(0, 64) : remote;
}
