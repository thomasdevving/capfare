import { computePremium, flightKeyHash, type FlightKey, type Params, type SnapshotRecord, type VaultState } from "@capfare/shared";
import { viewClient } from "./chain";
import { serverConfig } from "./config";

export interface QuoteInputs {
  flight_key_hash: string;
  snapshot: SnapshotRecord;
  vault: VaultState;
  params: Params;
  exposure: [number, number];
  now: number;
  oracleNote: string | null;
}

/** Fresh oracle snapshot (submitted on-chain via the relayer), then the on-chain inputs. */
export async function quoteInputs(fk: FlightKey, product: "cap" | "drop", refresh = true): Promise<QuoteInputs | { error: string; status: number }> {
  const c = serverConfig();
  const fkh = flightKeyHash(fk);
  const v = viewClient();
  let oracleNote: string | null = null;
  if (refresh && c.oracleUrl) {
    try {
      const r = await fetch(`${c.oracleUrl}/v1/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flight_key: fk, submit: true }), cache: "no-store" });
      const j = (await r.json()) as { snapshot?: { snapshot: { observed_at: number } }; error?: string };
      if (!r.ok) oracleNote = j.error ?? "no fresh price";
      else {
        const target = j.snapshot!.snapshot.observed_at;
        for (let i = 0; i < 16; i++) {
          const s = await v.view<SnapshotRecord | null>(c.attestation, "get_latest_snapshot", { flight_key_hash: fkh });
          if (s && s.observed_at >= target) break;
          await new Promise((res) => setTimeout(res, 500));
        }
      }
    } catch {
      oracleNote = "price service unreachable";
    }
  }
  const vault = product === "drop" ? c.dropVault : c.capVault;
  const [snapshot, vs, params, exposure, now] = await Promise.all([
    v.view<SnapshotRecord | null>(c.attestation, "get_latest_snapshot", { flight_key_hash: fkh }),
    v.view<VaultState>(vault, "get_state"),
    v.view<Params>(c.registry, "get_params"),
    v.view<[number, number]>(c.registry, "get_flight_exposure", { product, flight_key_hash: fkh }),
    v.blockTimeSecs(),
  ]);
  if (!snapshot) {
    return {
      error: oracleNote?.includes("no price source") ? "We don't have a price source for this flight yet." : `No verified price for this flight yet${oracleNote ? ` (${oracleNote})` : ""}.`,
      status: 404,
    };
  }
  return { flight_key_hash: fkh, snapshot, vault: vs, params, exposure, now, oracleNote };
}

export function premiumFor(q: QuoteInputs, product: "cap" | "drop", strike: number) {
  const pp = q.params[product];
  return computePremium(pp, {
    product,
    current_price: q.snapshot.price_minor,
    strike,
    signals: q.snapshot.signals,
    now: q.now,
    departure_ts: q.snapshot.departure_ts,
    vault_total_assets: q.vault.total_assets,
    vault_locked: q.vault.locked_coverage,
    vault_reserved: q.vault.pending_withdrawals,
    new_lock: (BigInt(pp.max_payout) * BigInt(q.params.global.usdc_micro_per_cent)).toString(),
    flight_exposure: q.exposure[0],
  });
}

export const defaultCap = (price: number) => Math.ceil((price * 1.06) / 500) * 500;
