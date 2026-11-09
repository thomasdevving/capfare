/** Periodic snapshots for every flight or route with an active or claimed policy. */
import { NearViewClient, type Policy, type SignedSnapshot } from "@capfare/shared";
import type { Oracle } from "./oracle.ts";

export interface SchedulerOptions {
  oracle: Oracle;
  rpc: NearViewClient;
  registryId: string;
  submit: (batch: SignedSnapshot[]) => Promise<string[]>;
  baseIntervalSecs?: number; // default 3600
  nearDepartureIntervalSecs?: number; // default 900 within 48h of departure
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export function dueFlights(policies: Policy[], lastAt: Map<string, number>, now: number, base = 3600, near = 900) {
  const seen = new Map<string, Policy>();
  for (const p of policies) if (p.state === "active" || p.state === "claimed") seen.set(p.flight_key_hash, p);
  return [...seen.values()].filter((p) => {
    const interval = p.departure_ts - now < 48 * 3600 ? near : base;
    return now - (lastAt.get(p.flight_key_hash) ?? 0) >= interval && p.departure_ts > now;
  });
}

export async function tick(o: SchedulerOptions, lastAt: Map<string, number>): Promise<number> {
  const policies: Policy[] = [];
  for (let from = 0; ; from += 100) {
    const page = await o.rpc.view<Policy[]>(o.registryId, "get_active_policies", { from_index: from, limit: 100 });
    policies.push(...page);
    if (page.length < 100) break;
  }
  const now = Math.floor(Date.now() / 1000);
  const due = dueFlights(policies, lastAt, now, o.baseIntervalSecs, o.nearDepartureIntervalSecs);
  const batch: SignedSnapshot[] = [];
  for (const p of due) {
    try {
      if ("route" in p.coverage) {
        const r = await o.oracle.routeSnapshot(p.coverage.route);
        batch.push(r.route, ...r.flights);
      } else {
        batch.push(await o.oracle.snapshot(p.coverage.flight));
      }
      lastAt.set(p.flight_key_hash, now);
    } catch (e) {
      o.log?.("snapshot_failed", { policy: p.id, error: String(e) });
    }
  }
  for (let i = 0; i < batch.length; i += 50) await o.submit(batch.slice(i, i + 50));
  return batch.length;
}
