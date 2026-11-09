/**
 * Passenger binding. A policy stores only a commitment to the lead passenger's last name:
 *   sha256("capfare/passenger/v1" || borsh(normalised last name) || salt)
 * The salt is derived from the user's own key, so only the user (and the enclave, when the
 * user hands it the salt for a claim) can link a booking to the policy. The name never
 * leaves the device or the enclave.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { BorshWriter, bytesToHex, hexToBytes } from "./borsh.ts";

export const PASSENGER_DOMAIN = "capfare/passenger/v1";
export const SALT_MESSAGE = "capfare/passenger-salt/v1:";

export function normalizeLastName(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

export function passengerCommitment(lastName: string, saltHex: string): string {
  const n = normalizeLastName(lastName);
  if (!n) throw new Error("last name required");
  const salt = hexToBytes(saltHex);
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  const d = new TextEncoder().encode(PASSENGER_DOMAIN);
  const body = new BorshWriter().string(n).bytes();
  return bytesToHex(sha256(new Uint8Array([...d, ...body, ...salt])));
}

/** Salt from a deterministic ed25519 signature over a fixed message (same key ⇒ same salt). */
export function saltFromSignature(signature: Uint8Array): string {
  return bytesToHex(sha256(signature));
}
