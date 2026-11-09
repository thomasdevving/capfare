/**
 * Requests signed with a NEAR account's own ed25519 access key (no transaction, no gas). Used
 * to change notification settings: the service checks the signature and that the key is an
 * access key of the account on-chain, so only the account holder can subscribe channels.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./borsh.ts";

export interface SignedAccountRequest<T> {
  account_id: string;
  /** "ed25519:<base58>" as NEAR shows access keys. */
  public_key: string;
  /** Unix seconds; accepted within ±max_skew. */
  ts: number;
  payload: T;
  /** hex ed25519 signature over accountRequestMessage(...). */
  signature: string;
}

export const ACCOUNT_REQUEST_DOMAIN = "capfare/account-request/v1";

export function accountRequestMessage(scope: string, accountId: string, ts: number, payload: unknown): Uint8Array {
  const body = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(payload))));
  return new TextEncoder().encode(`${ACCOUNT_REQUEST_DOMAIN}\n${scope}\n${accountId}\n${ts}\n${body}`);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("invalid base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Checks signature and freshness only; the caller also checks the key belongs to the account. */
export function verifyAccountRequest<T>(scope: string, r: SignedAccountRequest<T>, now: number, maxSkew = 300): string | null {
  if (!r || typeof r.account_id !== "string" || typeof r.public_key !== "string") return "malformed request";
  if (!Number.isInteger(r.ts) || Math.abs(now - r.ts) > maxSkew) return "request expired; check your device clock";
  if (!r.public_key.startsWith("ed25519:")) return "only ed25519 keys are supported";
  let pk: Uint8Array;
  try {
    pk = base58Decode(r.public_key.slice(8));
  } catch {
    return "invalid public key";
  }
  if (pk.length !== 32) return "invalid public key";
  try {
    const ok = ed25519.verify(hexToBytes(r.signature), accountRequestMessage(scope, r.account_id, r.ts, r.payload), pk, { zip215: false });
    return ok ? null : "bad signature";
  } catch {
    return "bad signature";
  }
}
