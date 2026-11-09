"use client";
/**
 * Browser wallet for the testnet prototype (see docs/DECISIONS.md D15).
 *
 * The ed25519 key is derived from a passkey via the WebAuthn PRF extension when the
 * browser supports it (the key is re-derived on every use and never stored). Otherwise
 * a device key is kept in localStorage — acceptable only for testnet, and labelled so.
 * All transactions are NEP-366 delegate actions submitted by the relayer (gasless).
 */
import { Account, actions, encodeSignedDelegate, JsonRpcProvider, KeyPair, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";
import { baseEncode } from "near-api-js";
import { accountRequestMessage, bytesToHex, passengerCommitment, SALT_MESSAGE, saltFromSignature, type SignedAccountRequest } from "@capfare/shared";

const STORE = "capfare.wallet.v1";

interface Stored {
  accountId: string;
  mode: "passkey" | "device";
  credentialId?: string; // base64url
  deviceKey?: KeyPairString;
  prfSalt?: string; // base64
}

export interface Session {
  accountId: string;
  mode: "passkey" | "device";
}

function load(): Stored | null {
  try {
    const s = localStorage.getItem(STORE);
    return s ? (JSON.parse(s) as Stored) : null;
  } catch {
    return null;
  }
}

export function session(): Session | null {
  const s = load();
  return s ? { accountId: s.accountId, mode: s.mode } : null;
}

export function signOut() {
  localStorage.removeItem(STORE);
  window.dispatchEvent(new Event("capfare-session"));
}

const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function keyFromSeed(seed: Uint8Array): KeyPair {
  // near-api-js accepts "ed25519:<base58(secret||public)>"; ed25519 secret from seed via KeyPair.fromString is not
  // available, so we use the seed as the 32-byte secret and let the library derive the public key.
  return KeyPair.fromString(`ed25519:${baseEncode(seed)}` as KeyPairString);
}

export async function passkeySupported(): Promise<boolean> {
  try {
    const pk = (window as unknown as { PublicKeyCredential?: { getClientCapabilities?: () => Promise<Record<string, boolean>> } }).PublicKeyCredential;
    if (!pk) return false;
    const caps = await pk.getClientCapabilities?.();
    return Boolean(caps && (caps["extension:prf"] || caps.prf));
  } catch {
    return false;
  }
}

async function prfKey(credentialId: string, salt: Uint8Array): Promise<KeyPair> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: unb64u(credentialId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const out = (cred?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } })?.prf?.results?.first;
  if (!out) throw new Error("This passkey cannot derive keys (PRF not available)");
  return keyFromSeed(new Uint8Array(out).slice(0, 32));
}

async function createPasskey(name: string): Promise<{ credentialId: string; key: KeyPair; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "CapFare (testnet)" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name, displayName: name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential;
  const credentialId = b64u(cred.rawId);
  const res = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
  const first = res.prf?.results?.first;
  const key = first ? keyFromSeed(new Uint8Array(first).slice(0, 32)) : await prfKey(credentialId, salt);
  return { credentialId, key, salt };
}

export async function createAccount(name: string, usePasskey: boolean): Promise<Session> {
  let stored: Stored;
  let key: KeyPair;
  if (usePasskey) {
    const p = await createPasskey(name);
    key = p.key;
    stored = { accountId: "", mode: "passkey", credentialId: p.credentialId, prfSalt: b64u(p.salt) };
  } else {
    key = KeyPair.fromRandom("ed25519");
    stored = { accountId: "", mode: "device", deviceKey: key.toString() as KeyPairString };
  }
  const r = await fetch("/api/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, public_key: key.getPublicKey().toString() }),
  });
  const j = (await r.json()) as { account_id?: string; error?: string };
  if (!r.ok || !j.account_id) throw new Error(j.error ?? "Account creation failed");
  stored.accountId = j.account_id;
  localStorage.setItem(STORE, JSON.stringify(stored));
  window.dispatchEvent(new Event("capfare-session"));
  return { accountId: stored.accountId, mode: stored.mode };
}

async function currentKey(): Promise<KeyPair> {
  const s = load();
  if (!s) throw new Error("Sign in first");
  if (s.mode === "device" && s.deviceKey) return KeyPair.fromString(s.deviceKey);
  if (s.mode === "passkey" && s.credentialId && s.prfSalt) return prfKey(s.credentialId, unb64u(s.prfSalt));
  throw new Error("No usable key; create the account again");
}

export interface RelayResult {
  tx_hash: string;
  ok: boolean;
  error?: string;
  events?: { event: string; data: Record<string, unknown> }[];
  receipt_failures?: string[];
}

/** Signs a delegate action with the user's key and lets the relayer pay the gas. */
export async function gasless(receiverId: string, method: string, args: Record<string, unknown>, deposit = 0n): Promise<RelayResult> {
  const s = load();
  if (!s) throw new Error("Sign in first");
  const key = await currentKey();
  const provider = new JsonRpcProvider({ url: `${location.origin}/api/rpc` });
  const account = new Account(s.accountId, provider, new KeyPairSigner(key));
  const { signedDelegate } = await account.createSignedMetaTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, teraToGas(300), deposit)],
    blockHeightTtl: 120,
  } as never);
  const bytes = encodeSignedDelegate(signedDelegate);
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signed_delegate: btoa(String.fromCharCode(...bytes)) }),
  });
  const j = (await r.json()) as RelayResult & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `relayer ${r.status}`);
  const failed = (j.events ?? []).find((e) => /failed|rejected/.test(e.event));
  if (failed) throw new Error(String((failed.data as { reason?: string })?.reason ?? failed.event));
  if (!j.ok) throw new Error(friendly(j.error ?? "transaction failed"));
  if (j.receipt_failures?.length && !(j.events ?? []).length) throw new Error(friendly(j.receipt_failures[0]));
  return j;
}

function friendly(m: string): string {
  const x = /Smart contract panicked: ([^"\\]+)/.exec(m);
  return x ? x[1] : m;
}

/**
 * Passenger salt: sha256 of a deterministic ed25519 signature over a fixed message, so the
 * same key always gives the same salt (also after clearing the browser, for passkey users).
 */
export async function passengerSalt(): Promise<string> {
  const s = load();
  if (!s) throw new Error("Sign in first");
  const key = await currentKey();
  const sig = key.sign(new TextEncoder().encode(SALT_MESSAGE + s.accountId)).signature;
  return saltFromSignature(sig);
}

export async function commitmentFor(lastName: string): Promise<string> {
  return passengerCommitment(lastName, await passengerSalt());
}

const NAME_KEY = "capfare.passenger.last";
/** Remembered on this device only, to prefill forms. Never sent anywhere in clear. */
export function rememberedLastName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function rememberLastName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

/** Signs a request with the account's own key (no transaction): used for alert settings. */
export async function signAccountRequest<T>(scope: string, payload: T): Promise<SignedAccountRequest<T>> {
  const s = load();
  if (!s) throw new Error("Sign in first");
  const key = await currentKey();
  const ts = Math.floor(Date.now() / 1000);
  const sig = key.sign(accountRequestMessage(scope, s.accountId, ts, payload)).signature;
  return { account_id: s.accountId, public_key: key.getPublicKey().toString(), ts, payload, signature: bytesToHex(sig) };
}
