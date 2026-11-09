/**
 * Off-chain verification of an enclave's attestation report before its key is proposed
 * on-chain. NEAR contracts cannot cheaply verify a full TDX quote here, so this script is
 * the check, and its output hash is published with the timelocked key proposal.
 *
 * Checks:
 *  - report_data == sha256(signing_pubkey || box_pubkey)  (binds the keys to the quote)
 *  - for TDX quotes: the quote's TD report REPORTDATA field starts with report_data
 *  - for TDX quotes: if the `dcap-qvl` CLI is installed, the quote signature chain and TCB
 *    status are verified with it (Intel PCS collateral)
 *  - "dev" reports are refused unless --allow-dev (demo deployments only)
 */
import { execFileSync } from "node:child_process";
import { reportData } from "@capfare/tee-common";
import { hexToBytes, bytesToHex } from "@capfare/shared";
import type { EnclaveInfo } from "./register-keys.ts";
import { fileURLToPath } from "node:url";

export function verifyEnclaveReport(info: EnclaveInfo, opts: { allowDev: boolean }): { ok: boolean; reason?: string; note?: string } {
  if (!info.box_public_key) return { ok: false, reason: "enclave did not publish its box key" };
  if (info.report.report_data !== reportData(info.signing_public_key, info.box_public_key)) {
    return { ok: false, reason: "report_data does not commit to the published keys" };
  }
  if (info.report.kind === "dev") {
    if (!opts.allowDev) return { ok: false, reason: "development key (not a TEE); only demo deployments may register it" };
    return { ok: true, note: "DEV KEY — not running in a TEE (demo deployment)" };
  }
  if (info.report.kind === "tdx-dstack") {
    if (!info.report.quote) return { ok: false, reason: "missing quote" };
    const q = hexToBytes(info.report.quote.replace(/^0x/, ""));
    // TDX quote v4: 48-byte header, then the TD report; REPORTDATA is its last 64 bytes (offset 48 + 520).
    const rd = bytesToHex(q.slice(48 + 520, 48 + 520 + 32));
    if (rd !== info.report.report_data) return { ok: false, reason: "quote REPORTDATA does not commit to these keys" };
    try {
      execFileSync("dcap-qvl", ["verify", "--hex", "-"], { input: info.report.quote, stdio: ["pipe", "pipe", "pipe"] });
      return { ok: true, note: "TDX quote verified with dcap-qvl" };
    } catch (e) {
      return { ok: false, reason: `dcap-qvl verification failed or not installed: ${String(e).slice(0, 200)}` };
    }
  }
  return { ok: false, reason: `unknown report kind ${info.report.kind}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.argv[2];
  if (!url) throw new Error("usage: verify-report <service-url> [--allow-dev]");
  fetch(`${url}/v1/enclave`)
    .then((r) => r.json())
    .then((info) => console.log(JSON.stringify(verifyEnclaveReport(info as EnclaveInfo, { allowDev: process.argv.includes("--allow-dev") }), null, 2)));
}
