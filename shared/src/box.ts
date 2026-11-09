/**
 * Client-side sealing to an enclave's X25519 key (ECIES: X25519 + HKDF-SHA256 + AES-256-GCM).
 * Used by the web app and the extension to encrypt .eml files and booking references so
 * that only the booking_verifier enclave can read them. Works in browsers and Node 20+.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./borsh.ts";

export interface SealedBox {
  v: 1;
  epk: string; // hex ephemeral X25519 public key
  iv: string; // hex 12 bytes
  ct: string; // base64 ciphertext+tag
}

const INFO = new TextEncoder().encode("capfare/seal/v1");

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(shared: Uint8Array, epk: Uint8Array, rpk: Uint8Array): Promise<CryptoKey> {
  const salt = sha256(new Uint8Array([...epk, ...rpk]));
  const raw = hkdf(sha256, shared, salt, INFO, 32);
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function boxKeyFromSeed(seed: Uint8Array): { secretKey: Uint8Array; publicKeyHex: string } {
  return { secretKey: seed, publicKeyHex: bytesToHex(x25519.getPublicKey(seed)) };
}

export async function seal(plaintext: Uint8Array, recipientPublicKeyHex: string): Promise<SealedBox> {
  const rpk = hexToBytes(recipientPublicKeyHex);
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const shared = x25519.getSharedSecret(esk, rpk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(shared, epk, rpk);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource));
  return { v: 1, epk: bytesToHex(epk), iv: bytesToHex(iv), ct: b64(ct) };
}

export async function sealJson(value: unknown, recipientPublicKeyHex: string): Promise<SealedBox> {
  return seal(new TextEncoder().encode(JSON.stringify(value)), recipientPublicKeyHex);
}

export async function open(box: SealedBox, secretKey: Uint8Array): Promise<Uint8Array> {
  if (box.v !== 1) throw new Error("unsupported box version");
  const epk = hexToBytes(box.epk);
  const rpk = x25519.getPublicKey(secretKey);
  const shared = x25519.getSharedSecret(secretKey, epk);
  const key = await aesKey(shared, epk, rpk);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(box.iv) as BufferSource }, key, unb64(box.ct) as BufferSource);
  return new Uint8Array(pt);
}

export async function openJson<T>(box: SealedBox, secretKey: Uint8Array): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(box, secretKey))) as T;
}
