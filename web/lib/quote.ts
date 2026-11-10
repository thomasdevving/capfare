import { coverageHash, type Coverage, type FlightKey, type Params, type SnapshotRecord, type VaultState } from "@capfare/shared";
import { viewClient } from "./chain";
import { serverConfig } from "./config";

export interface RouteFlight {
  flight_key: FlightKey;
  price_minor: number;
  available: boolean;
}

export interface QuoteInputs {
  /** Coverage hash (flight key hash, or route key hash). */
  flight_key_hash: string;
  snapshot: SnapshotRecord;
  vault: VaultState;
  params: Params;
  exposure: [number, number];
  now: number;
  oracleNote: string | null;
  /** Route coverage: the flights in the index and their prices now. */
  routeFlights?: RouteFlight[];
}

/** Fresh oracle snapshot (submitted on-chain via the relayer), then the on-chain inputs. */
export async function quoteInputs(coverage: Coverage, product: "cap" | "drop", refresh = true): Promise<QuoteInputs | { error: string; status: number }> {
  const c = serverConfig();
  const fkh = coverageHash(coverage);
  const v = viewClient();
  let oracleNote: string | null = null;
  let routeFlights: RouteFlight[] | undefined;
  if (refresh && c.oracleUrl) {
    try {
      const body = "route" in coverage ? { route: coverage.route, submit: true } : { flight_key: coverage.flight, submit: true };
      const r = await fetch(`${c.oracleUrl}/v1/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const j = (await r.json()) as { snapshot?: { snapshot: { observed_at: number } }; flights?: RouteFlight[]; error?: string };
      if (!r.ok) oracleNote = j.error ?? "no fresh price";
      else {
        routeFlights = j.flights;
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
      error: oracleNote?.includes("no price source") ? `We don't have a price source for ${"route" in coverage ? "flights on this route and day" : "this flight"} yet.` : `No verified price yet${oracleNote ? ` (${oracleNote})` : ""}.`,
      status: 404,
    };
  }
  return { flight_key_hash: fkh, snapshot, vault: vs, params, exposure, now, oracleNote, routeFlights };
}

export { premiumFor } from "./premium";

export { defaultCap } from "@capfare/shared";
