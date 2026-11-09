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
