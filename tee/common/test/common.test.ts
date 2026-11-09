import { describe, expect, it } from "vitest";
import { devKeys, redact, RateLimiter, reportData } from "../src/index.ts";

describe("dev keys", () => {
  it("are deterministic per seed and bound into report data", () => {
    process.env.CAPFARE_DEPLOYMENT = "test";
    const a = devKeys("price_oracle", "11".repeat(32));
    const b = devKeys("price_oracle", "11".repeat(32));
    expect(a.signing.publicKeyHex).toBe(b.signing.publicKeyHex);
    expect(a.report.report_data).toBe(reportData(a.signing.publicKeyHex, a.box.publicKeyHex));
    expect(devKeys("booking_verifier", "11".repeat(32)).signing.publicKeyHex).not.toBe(a.signing.publicKeyHex);
  });
  it("refuse production", () => {
    process.env.CAPFARE_DEPLOYMENT = "production";
    expect(() => devKeys("price_oracle")).toThrow(/not allowed/);
    process.env.CAPFARE_DEPLOYMENT = "test";
  });
});

describe("redaction", () => {
  it("removes PII keys", () => {
    const r = redact({ last_name: "Jansen", booking_ref: "ABC123", nested: { email: "a@b.c", price: 1 } }) as any;
    expect(JSON.stringify(r)).not.toMatch(/Jansen|ABC123|a@b\.c/);
    expect(r.nested.price).toBe(1);
  });
});

describe("rate limiter", () => {
  it("limits bursts", () => {
    const rl = new RateLimiter(2, 1);
    expect(rl.take("k", 0)).toBe(true);
    expect(rl.take("k", 0)).toBe(true);
    expect(rl.take("k", 0)).toBe(false);
    expect(rl.take("k", 1500)).toBe(true);
  });
});
