/**
 * Enclave key registration (timelocked):
 *   1. fetch the service's /v1/enclave (public keys, measurement, attestation report)
 *   2. verify the report off-chain (verify-report.ts)
 *   3. publish sha256(report) on-chain with propose_key; anyone applies it after the timelock
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@capfare/shared";
import type { Chain } from "./chain.ts";
import { verifyEnclaveReport } from "./verify-report.ts";
import { sleep } from "./config.ts";

export interface EnclaveInfo {
  service: "price_oracle" | "booking_verifier";
  signing_public_key: string;
  box_public_key?: string;
  measurement: string;
  report: { kind: string; report_data: string; quote?: string };
}

export async function fetchEnclave(url: string): Promise<EnclaveInfo> {
  const r = await fetch(`${url.replace(/\/$/, "")}/v1/enclave`);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as EnclaveInfo;
}

export async function registerEnclaveKey(chain: Chain, owner: string, attestation: string, info: EnclaveInfo, opts: { allowDev: boolean }) {
  const check = verifyEnclaveReport(info, opts);
  if (!check.ok) throw new Error(`attestation report rejected: ${check.reason}`);
  const keys = await chain.view<[string, unknown][]>(attestation, "get_keys");
  if (keys.some(([k]) => k === info.signing_public_key)) return "already registered";
  const reportHash = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(info.report))));
  await chain.call(owner, attestation, "propose_key", {
    public_key: info.signing_public_key,
    service: info.service,
    measurement: info.measurement,
    report_hash: reportHash,
  });
  const cfg = await chain.view<{ key_timelock_secs: number }>(attestation, "get_config");
  await sleep((cfg.key_timelock_secs + 2) * 1000);
  await chain.call(owner, attestation, "apply_key", { public_key: info.signing_public_key });
  return `registered (${check.note})`;
}
