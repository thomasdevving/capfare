/** Server-side cached reads of CapFare contracts. */
import { NearViewClient, type Params, type Policy, type SnapshotRecord, type VaultState } from "@capfare/shared";
import { createHash } from "node:crypto";
import { configured, serverConfig } from "./config";

const cache = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.value as T;
  const value = await f();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function viewClient() {
  return new NearViewClient({ rpcUrl: serverConfig().rpcUrl, timeoutMs: 6000 });
}

export interface KeyInfo {
  service: string;
  measurement: string;
  report_hash: string;
  registered_at: number;
  revoked: boolean;
  /** Added here, not on-chain: true if the measurement is the development-key measurement
   *  (tee/common/src/keys.ts devKeys), i.e. the service does not run in a TEE. */
  dev?: boolean;
}

/** Measurement that development keys report (sha256 of a fixed label per service). */
const devMeasurement = (service: string) => createHash("sha256").update(`capfare-dev-measurement:${service}:v1`).digest("hex");

export interface Overview {
  network: string;
  updatedAt: number;
  contracts: { registry: string; attestation: string; capVault: string; dropVault: string; token: string };
  vaults: { cap: VaultState; drop: VaultState };
  stats: { policies_total: number; active_cap: number; active_drop: number; credit_total: string; in_flight: string; paused: boolean };
  params: Params;
  pendingParams: { params: Params; apply_after: number; proposed_at: number } | null;
  keys: [string, KeyInfo][];
  pendingKeys: [string, { service: string; measurement: string; apply_after: number }][];
  attestationConfig: { allow_demo_sources: boolean; key_timelock_secs: number };
  activePolicies: Policy[];
  flights: { flight_key_hash: string; latest: SnapshotRecord | null; count: number }[];
}

export async function overview(): Promise<Overview> {
  const c = serverConfig();
  if (!configured(c)) throw new Error("contracts are not configured on this server");
  return cached("overview", 10_000, async () => {
    const v = viewClient();
    const [cap, drop, stats, params, pendingParams, keys, pendingKeys, attCfg, active, flights] = await Promise.all([
      v.view<VaultState>(c.capVault, "get_state"),
      v.view<VaultState>(c.dropVault, "get_state"),
      v.view<Overview["stats"]>(c.registry, "get_stats"),
      v.view<Params>(c.registry, "get_params"),
      v.view<Overview["pendingParams"]>(c.registry, "get_pending_params"),
      v.view<[string, KeyInfo][]>(c.attestation, "get_keys"),
      v.view<Overview["pendingKeys"]>(c.attestation, "get_pending_keys"),
      v.view<Overview["attestationConfig"]>(c.attestation, "get_config"),
      v.view<Policy[]>(c.registry, "get_active_policies", { from_index: 0, limit: 200 }),
      v.view<Overview["flights"]>(c.attestation, "get_flights", { from_index: 0, limit: 200 }),
    ]);
    return {
      network: c.network,
      updatedAt: Math.floor(Date.now() / 1000),
      contracts: { registry: c.registry, attestation: c.attestation, capVault: c.capVault, dropVault: c.dropVault, token: c.token },
      vaults: { cap, drop },
      stats,
      params,
      pendingParams,
      keys: keys.map(([k, v]) => [k, { ...v, dev: v.measurement === devMeasurement(v.service) }] as [string, KeyInfo]),
      pendingKeys,
      attestationConfig: attCfg,
      activePolicies: active,
      flights,
    };
  });
}
