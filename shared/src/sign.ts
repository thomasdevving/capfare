import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "./borsh.ts";
import { attestationDigest, snapshotDigest } from "./encoding.ts";
import type { BookingAttestation, PriceSnapshot, SignedBookingAttestation, SignedSnapshot } from "./types.ts";

export interface EnclaveKey {
  secretKey: Uint8Array; // 32-byte seed
  publicKeyHex: string;
}

export function keyFromSeed(seed: Uint8Array): EnclaveKey {
  return { secretKey: seed, publicKeyHex: bytesToHex(ed25519.getPublicKey(seed)) };
}

export function randomKey(): EnclaveKey {
  return keyFromSeed(ed25519.utils.randomSecretKey());
}

export function signSnapshot(s: PriceSnapshot, k: EnclaveKey): SignedSnapshot {
  return { snapshot: s, signer: k.publicKeyHex, signature: bytesToHex(ed25519.sign(snapshotDigest(s), k.secretKey)) };
}

export function signAttestation(a: BookingAttestation, k: EnclaveKey): SignedBookingAttestation {
  return { attestation: a, signer: k.publicKeyHex, signature: bytesToHex(ed25519.sign(attestationDigest(a), k.secretKey)) };
}

export function verifySnapshot(s: SignedSnapshot): boolean {
  try {
    return ed25519.verify(hexToBytes(s.signature), snapshotDigest(s.snapshot), hexToBytes(s.signer), { zip215: false });
  } catch {
    return false;
  }
}

export function verifyAttestation(a: SignedBookingAttestation): boolean {
  try {
    return ed25519.verify(hexToBytes(a.signature), attestationDigest(a.attestation), hexToBytes(a.signer), { zip215: false });
  } catch {
    return false;
  }
}
