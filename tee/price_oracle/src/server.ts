/**
 * price_oracle service.
 *   GET  /health
 *   GET  /v1/enclave            signing key, measurement, attestation report
 *   POST /v1/snapshot           {flight_key, submit?} -> signed snapshot (on-demand, for quotes)
 *   GET  /v1/demo/paths         (demo only) scripted paths and cursors
 *   POST /v1/demo/advance       (demo only) {flight_key, to?}
 */
import { fileURLToPath } from "node:url";
import { NearViewClient, type FlightKey } from "@capfare/shared";
import { HttpError, loadKeys, logger, RateLimiter, serve } from "@capfare/tee-common";
import { ScriptedPriceAdapter } from "./adapters/scripted.ts";
import { AIRLINE_SITES, AirlineSiteAdapter } from "./adapters/airline-page.ts";
import type { PriceAdapter } from "./adapters/types.ts";
import { Oracle, submitViaRelayer } from "./oracle.ts";
import { tick } from "./scheduler.ts";

const log = logger("price_oracle");

export async function main() {
  const mode = process.env.CAPFARE_DEPLOYMENT ?? "dev";
  const keys = await loadKeys("price_oracle");
  const adapters: PriceAdapter[] = [];
  let scripted: ScriptedPriceAdapter | undefined;
  if (mode === "demo" || mode === "test") {
    scripted = ScriptedPriceAdapter.fromFile(process.env.DEMO_PATHS ?? fileURLToPath(new URL("../demo/price_paths.json", import.meta.url)));
    adapters.push(scripted);
  }
  for (const site of AIRLINE_SITES) {
    const a = new AirlineSiteAdapter(site);
    if (a.access === "live") adapters.push(a);
  }
  const oracle = new Oracle({ keys, adapters });
  const relayer = process.env.RELAYER_URL;
  const submit = async (batch: Parameters<typeof submitViaRelayer>[1]) =>
    relayer ? submitViaRelayer(relayer, batch, process.env.RELAYER_SERVICE_TOKEN) : batch.map(() => "not submitted (no RELAYER_URL)");
  const perClient = new RateLimiter(20, 0.5);

  serve({
    port: Number(process.env.PORT ?? 8081),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
    log,
    routes: {
      "GET /health": () => ({ ok: true, mode, adapters: adapters.map((a) => ({ id: a.id, access: a.access })) }),
      "GET /v1/enclave": () => ({
        service: "price_oracle",
        signing_public_key: keys.signing.publicKeyHex,
        box_public_key: keys.box.publicKeyHex,
        measurement: keys.measurement,
        report: keys.report,
      }),
      "POST /v1/snapshot": async (body: { flight_key: FlightKey; submit?: boolean }, req) => {
        if (!perClient.take(req.socket.remoteAddress ?? "?")) throw new HttpError(429, "too many requests");
        if (!body?.flight_key) throw new HttpError(400, "flight_key required");
        const s = await oracle.snapshot(body.flight_key).catch((e) => {
          throw new HttpError(422, String(e instanceof Error ? e.message : e));
        });
        const results = body.submit === false ? [] : await submit([s]);
        return { snapshot: s, submitted: results[0] ?? null };
      },
      "GET /v1/demo/paths": () => {
        if (!scripted) throw new HttpError(404, "not a demo deployment");
        return scripted.list();
      },
      "POST /v1/demo/advance": (body: { flight_key: FlightKey; to?: number }) => {
        if (!scripted) throw new HttpError(404, "not a demo deployment");
        return scripted.advance(body.flight_key, body.to);
      },
    },
  });

  const registryId = process.env.REGISTRY_ID;
  if (registryId && process.env.NEAR_RPC_URL) {
    const rpc = new NearViewClient({ rpcUrl: process.env.NEAR_RPC_URL });
    const lastAt = new Map<string, number>();
    const every = Number(process.env.ORACLE_TICK_SECS ?? 60) * 1000;
    setInterval(() => {
      tick({ oracle, rpc, registryId, submit, log }, lastAt).catch((e) => log("tick_failed", { error: String(e) }));
    }, every);
  }
  log("started", { mode, signing_public_key: keys.signing.publicKeyHex, measurement: keys.measurement });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
