/**
 * Enclave key management.
 *
 * In production the service runs inside an Intel TDX confidential VM managed by dstack
 * (Phala Cloud). All key material is derived from the dstack KMS, bound to the app's
 * measurement, and never leaves the enclave. The remote-attestation quote carries
 * sha256(signing_pubkey || box_pubkey) as report data, so a verifier can check that the
 * on-chain registered key belongs to the measured code.
 *
 * In dev/demo deployments `DevKeyProvider` derives keys from a seed in an environment
 * variable. It refuses to start unless CAPFARE_DEPLOYMENT is "dev", "demo" or "test".
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { boxKeyFromSeed, bytesToHex, hexToBytes, keyFromSeed, type EnclaveKey } from "@capfare/shared";

export type ServiceName = "price_oracle" | "booking_verifier";

export interface AttestationReport {
  kind: "dev" | "tdx-dstack";
  /** hex sha256(signing_pubkey || box_pubkey) — what the quote commits to */
  report_data: string;
  quote?: string;
  event_log?: string;
  note?: string;
}

export interface KeyMaterial {
  signing: EnclaveKey;
  box: { secretKey: Uint8Array; publicKeyHex: string };
  /** Secret salt for booking nullifiers: H(salt || airline || ref). Never exported. */
  salt: Uint8Array;
  /** hex 32 bytes; what the attestation registry stores as the allowed measurement */
  measurement: string;
  report: AttestationReport;
}

export function reportData(signingPubHex: string, boxPubHex: string): string {
  return bytesToHex(sha256(new Uint8Array([...hexToBytes(signingPubHex), ...hexToBytes(boxPubHex)])));
}

export function deploymentMode(): "dev" | "demo" | "test" | "production" {
  const m = process.env.CAPFARE_DEPLOYMENT ?? "dev";
  if (m === "dev" || m === "demo" || m === "test" || m === "production") return m;
  throw new Error(`unknown CAPFARE_DEPLOYMENT=${m}`);
}

function derive(seed: Uint8Array, label: string): Uint8Array {
  return hkdf(sha256, seed, new TextEncoder().encode("capfare"), new TextEncoder().encode(label), 32);
}

export function devKeys(service: ServiceName, seedHex?: string): KeyMaterial {
  const mode = deploymentMode();
  if (mode === "production") throw new Error("DevKeyProvider is not allowed in production deployments");
  const seed = seedHex ? hexToBytes(seedHex) : sha256(new TextEncoder().encode(`capfare-dev-seed:${service}`));
  if (seed.length !== 32) throw new Error("seed must be 32 bytes hex");
  const signing = keyFromSeed(derive(seed, `${service}/signing`));
  const box = boxKeyFromSeed(derive(seed, `${service}/box`));
  const measurement = bytesToHex(sha256(new TextEncoder().encode(`capfare-dev-measurement:${service}:v1`)));
  return {
    signing,
    box,
    salt: derive(seed, `${service}/nullifier-salt`),
    measurement,
    report: {
      kind: "dev",
      report_data: reportData(signing.publicKeyHex, box.publicKeyHex),
      note: "Development key: NOT running in a TEE. Accepted only by demo deployments.",
    },
  };
}

/** Keys from the dstack guest agent inside a TDX CVM. */
export async function dstackKeys(service: ServiceName): Promise<KeyMaterial> {
  const { DstackClient } = await import("@phala/dstack-sdk");
  const client = new DstackClient(process.env.DSTACK_SIMULATOR_ENDPOINT);
  const k = async (label: string) => (await client.getKey(`capfare/${service}/${label}`, "capfare")).key.slice(0, 32);
  const signing = keyFromSeed(await k("signing"));
  const box = boxKeyFromSeed(await k("box"));
  const salt = await k("nullifier-salt");
  const rd = reportData(signing.publicKeyHex, box.publicKeyHex);
  const q = await client.getQuote(hexToBytes(rd));
  const info = (await client.info()) as unknown as { compose_hash?: string; tcb_info?: { mrtd?: string } };
  // The registry stores a 32-byte measurement: sha256 of (mrtd || compose_hash).
  const measurement = bytesToHex(sha256(new TextEncoder().encode(`${info.tcb_info?.mrtd ?? ""}:${info.compose_hash ?? ""}`)));
  return { signing, box, salt, measurement, report: { kind: "tdx-dstack", report_data: rd, quote: String(q.quote), event_log: q.event_log } };
}

export async function loadKeys(service: ServiceName): Promise<KeyMaterial> {
  if (process.env.CAPFARE_KEY_PROVIDER === "dstack") return dstackKeys(service);
  const envName = service === "price_oracle" ? "ORACLE_DEV_SEED" : "VERIFIER_DEV_SEED";
  return devKeys(service, process.env[envName]);
}
