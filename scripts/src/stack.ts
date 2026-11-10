/**
 * Runs the complete CapFare stack locally on a NEAR sandbox:
 *   sandbox node -> price_oracle + booking_verifier (demo mode) -> deploy contracts and
 *   register enclave keys -> relayer -> notifier (alerts) -> (optionally) the web app.
 * Writes deployments/sandbox.json and web/.env.local. Ctrl-C stops everything.
 *
 *   pnpm --filter @capfare/scripts stack            # services only
 *   pnpm --filter @capfare/scripts stack -- --web   # also `next start` on :3000
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyPairString } from "near-api-js";
import { startSandbox } from "./sandbox.ts";
import { deploy } from "./deploy.ts";
import { DEPLOY_DIR, ROOT_DIR, sleep } from "./config.ts";

const procs: ChildProcess[] = [];

function run(name: string, args: string[], env: Record<string, string>, cwd = ROOT_DIR) {
  const p = spawn(args[0], args.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (s: Buffer) =>
    s.toString().split("\n").filter(Boolean).forEach((l) => process.env.STACK_QUIET ? null : console.log(`[${name}] ${l.slice(0, 300)}`));
  p.stdout?.on("data", tag);
  p.stderr?.on("data", tag);
  p.on("exit", (c) => console.log(`[${name}] exited ${c}`));
  procs.push(p);
  return p;
}

async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

export async function stack(opts: { web: boolean; webPort: number }) {
  const { sandbox, info } = await startSandbox(DEPLOY_DIR);
  console.log(`sandbox: ${info.rpcUrl}`);
  const site = process.env.SITE_URL ?? `http://localhost:${opts.webPort}`;
  const common = { CAPFARE_DEPLOYMENT: "demo", CORS_ORIGINS: `${site},http://localhost:${opts.webPort}` };
  const tsx = join(ROOT_DIR, "scripts", "node_modules", ".bin", "tsx");
  run("verifier", [tsx, "tee/booking_verifier/src/server.ts"], {
    ...common,
    PORT: "8082",
    DEMO_BOOKER_ORIGIN: `http://localhost:${opts.webPort}`,
    DEMO_BOOKER_PUBLIC_ORIGIN: site,
  });
  run("oracle", [tsx, "tee/price_oracle/src/server.ts"], { ...common, PORT: "8081", RELAYER_URL: "http://localhost:8083" });
  await waitFor("http://localhost:8081/health");
  await waitFor("http://localhost:8082/health");
  const d = await deploy({
    network: "sandbox",
    rpcUrl: info.rpcUrl,
    root: info.root,
    rootKey: info.rootKey as KeyPairString,
    paramsFile: join(ROOT_DIR, "backtest/output/demo_params.json"),
    demo: true,
    oracleUrl: "http://localhost:8081",
    verifierUrl: "http://localhost:8082",
  });
  run("relayer", [tsx, "relayer/src/server.ts"], {
    ...common,
    PORT: "8083",
    NEAR_NETWORK: "sandbox",
    NEAR_RPC_URL: info.rpcUrl,
    RELAYER_ACCOUNT_ID: d.relayer,
    RELAYER_PRIVATE_KEY: info.rootKey,
    REGISTRY_ID: d.registry,
    CAP_VAULT_ID: d.capVault,
    DROP_VAULT_ID: d.dropVault,
    TOKEN_ID: d.token,
    ATTESTATION_ID: d.attestation,
    TOKEN_IS_MOCK: "true",
    RELAYER_ACCOUNTS_PER_IP_DAY: process.env.RELAYER_ACCOUNTS_PER_IP_DAY ?? "5",
  });
  await waitFor("http://localhost:8083/health");
  run("notifier", [tsx, "notifier/src/server.ts"], {
    ...common,
    PORT: "8084",
    NEAR_RPC_URL: info.rpcUrl,
    REGISTRY_ID: d.registry,
    ATTESTATION_ID: d.attestation,
    SITE_URL: site,
  });
  await waitFor("http://localhost:8084/health");
  // Scheduler for the oracle needs registry info: restart-free, the demo pushes snapshots on demand.
  const webEnv = {
    CAPFARE_NETWORK: "sandbox",
    NEAR_RPC_URL: info.rpcUrl,
    REGISTRY_ID: d.registry,
    ATTESTATION_ID: d.attestation,
    CAP_VAULT_ID: d.capVault,
    DROP_VAULT_ID: d.dropVault,
    TOKEN_ID: d.token,
    ORACLE_URL: "http://localhost:8081",
    VERIFIER_URL: "http://localhost:8082",
    RELAYER_URL: "http://localhost:8083",
    NOTIFIER_URL: "http://localhost:8084",
    RAMP_ACCOUNT_ID: d.root,
    RAMP_PRIVATE_KEY: info.rootKey,
    CAPFARE_DEMO: "true",
    SITE_URL: site,
  };
  writeFileSync(join(ROOT_DIR, "web", ".env.local"), Object.entries(webEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  console.log("stack ready: oracle :8081, verifier :8082, relayer :8083, notifier :8084; web env written to web/.env.local");
  if (opts.web) {
    run("web", ["pnpm", "--filter", "web", "exec", "next", "start", "-p", String(opts.webPort)], { ...webEnv, PORT: String(opts.webPort) });
    await waitFor(`http://localhost:${opts.webPort}/api/health`, 120);
    console.log(`web: http://localhost:${opts.webPort}`);
  }
  const stop = async () => {
    for (const p of procs) p.kill("SIGTERM");
    await sandbox.tearDown().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return { deployment: d, stop };
}

if (process.argv[1]?.endsWith("stack.ts")) {
  stack({ web: process.argv.includes("--web"), webPort: Number(process.env.WEB_PORT ?? 3000) }).catch((e) => {
    console.error(e);
    for (const p of procs) p.kill("SIGTERM");
    process.exit(1);
  });
}
