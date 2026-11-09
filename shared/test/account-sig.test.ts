import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { accountRequestMessage, base58Decode, base58Encode, bytesToHex, verifyAccountRequest } from "../src/index.ts";

const seed = new Uint8Array(32).fill(3);
const pk = `ed25519:${base58Encode(ed25519.getPublicKey(seed))}`;
const sign = (account: string, ts: number, payload: unknown) => ({
  account_id: account, public_key: pk, ts, payload,
  signature: bytesToHex(ed25519.sign(accountRequestMessage("notify", account, ts, payload), seed)),
});

describe("account-signed requests", () => {
  it("round-trips base58 (with leading zero bytes)", () => {
    const b = Uint8Array.from([0, 0, 1, 2, 255, 7]);
    expect(base58Decode(base58Encode(b))).toEqual(b);
    expect(base58Encode(Uint8Array.from([0]))).toBe("1");
  });
  it("accepts a fresh, correctly signed request", () => {
    expect(verifyAccountRequest("notify", sign("alice.test", 1000, { action: "get" }), 1010)).toBeNull();
  });
  it("rejects stale, tampered, re-scoped or re-targeted requests", () => {
    const r = sign("alice.test", 1000, { action: "get" });
    expect(verifyAccountRequest("notify", r, 2000)).toMatch(/expired/);
    expect(verifyAccountRequest("notify", { ...r, payload: { action: "set_email", email: "x@y.z" } }, 1000)).toMatch(/bad signature/);
    expect(verifyAccountRequest("other", r, 1000)).toMatch(/bad signature/);
    expect(verifyAccountRequest("notify", { ...r, account_id: "bob.test" }, 1000)).toMatch(/bad signature/);
  });
});
