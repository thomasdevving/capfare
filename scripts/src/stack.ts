/**
 * Runs the complete CapFare stack, either on a fresh local NEAR sandbox (default) or against the
 * fixed NEAR testnet deployment in deployments/testnet.json (--testnet, or CAPFARE_NETWORK=testnet).
 * Sandbox mode:
 *   sandbox node -> price_oracle + booking_verifier (demo mode) -> deploy contracts and
 *   register enclave keys -> relayer -> notifier (alerts) -> (optionally) the web app.
 * Writes deployments/sandbox.json and web/.env.local. Ctrl-C stops everything.
 *
 *   pnpm --filter @capfare/scripts stack            # services only
 *   pnpm --filter @capfare/scripts stack -- --web   # also `next start` on :3000
 *   pnpm --filter @capfare/scripts stack -- --testnet --web   # testnet; secrets from the environment
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyPairString } from "near-api-js";
import { startSandbox } from "./sandbox.ts";
import { deploy } from "./deploy.ts";
import { DEPLOY_DIR, loadDeployment, ROOT_DIR, sleep, type Deployment } from "./config.ts";
import { Chain } from "./chain.ts";
import { fetchEnclave } from "./register-keys.ts";

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

export interface StackOptions {
  web: boolean;
  webPort: number;
  /** sandbox: fresh local chain + deploy (resets on restart). testnet: the fixed deployment in deployments/testnet.json. */
  network: "sandbox" | "testnet";
}

/**
 * Secrets for the testnet mode, from the environment (never from the repository):
 *   CAPFARE_ACCOUNT_KEY   full-access key of the deployment's root account (relayer, test-USDC ramp)
 *   ORACLE_DEV_SEED       32-byte hex seeds of the services' development keys; their public keys
 *   VERIFIER_DEV_SEED     are registered in the attestation contract by scripts/src/testnet-deploy.ts
 * Optional: NEAR_RPC_URL, NOTIFIER_DATA_FILE (put it on a volume so alert settings survive restarts).
 */
function testnetSecrets() {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`testnet mode needs ${k} (see scripts/src/stack.ts and docs/TESTNET.md)`);
    return v;
  };
  return { accountKey: need("CAPFARE_ACCOUNT_KEY") as KeyPairString, oracleSeed: need("ORACLE_DEV_SEED"), verifierSeed: need("VERIFIER_DEV_SEED") };
}

export async function stack(opts: StackOptions) {
  const site = process.env.SITE_URL ?? `http://localhost:${opts.webPort}`;
  // Optional: the Skyline Travel demo booking site's own public address (same app, host routing).
  const skyline = process.env.SKYLINE_URL;
  const common = { CAPFARE_DEPLOYMENT: "demo", CORS_ORIGINS: `${site},http://localhost:${opts.webPort}` };
  const tsx = join(ROOT_DIR, "scripts", "node_modules", ".bin", "tsx");
  let sandbox: Awaited<ReturnType<typeof startSandbox>>["sandbox"] | null = null;
  let rpcUrl: string;
  let accountKey: KeyPairString;
  let seeds: Record<string, string> = {};
  let sandboxRoot = "sandbox";
  if (opts.network === "testnet") {
    const sec = testnetSecrets();
    accountKey = sec.accountKey;
    seeds = { ORACLE_DEV_SEED: sec.oracleSeed, VERIFIER_DEV_SEED: sec.verifierSeed };
    rpcUrl = process.env.NEAR_RPC_URL ?? loadDeployment("testnet").rpcUrl;
  } else {
    const sb = await startSandbox(DEPLOY_DIR);
    sandbox = sb.sandbox;
    rpcUrl = sb.info.rpcUrl;
    accountKey = sb.info.rootKey as KeyPairString;
    sandboxRoot = sb.info.root;
    console.log(`sandbox: ${rpcUrl}`);
  }
  run("verifier", [tsx, "tee/booking_verifier/src/server.ts"], {
    ...common,
    ...seeds,
    PORT: "8082",
    DEMO_BOOKER_ORIGIN: `http://localhost:${opts.webPort}`,
    DEMO_BOOKER_PUBLIC_ORIGIN: [site, ...(skyline ? [skyline] : [])].join(","),
  });
  await waitFor("http://localhost:8082/health");
  let d: Deployment;
  if (opts.network === "testnet") {
    d = loadDeployment("testnet");
    // The oracle refreshes prices of active policies on testnet (the sandbox demo pushes them on demand).
    run("oracle", [tsx, "tee/price_oracle/src/server.ts"], { ...common, ...seeds, PORT: "8081", RELAYER_URL: "http://localhost:8083", REGISTRY_ID: d.registry, NEAR_RPC_URL: rpcUrl });
    await waitFor("http://localhost:8081/health");
    await checkKeys(d, rpcUrl);
  } else {
    run("oracle", [tsx, "tee/price_oracle/src/server.ts"], { ...common, PORT: "8081", RELAYER_URL: "http://localhost:8083" });
    await waitFor("http://localhost:8081/health");
    d = await deploy({
      network: "sandbox",
      rpcUrl,
      root: sandboxRoot,
      rootKey: accountKey,
      paramsFile: join(ROOT_DIR, "backtest/output/demo_params.json"),
      demo: true,
      oracleUrl: "http://localhost:8081",
      verifierUrl: "http://localhost:8082",
    });
  }
  run("relayer", [tsx, "relayer/src/server.ts"], {
    ...common,
    PORT: "8083",
    NEAR_NETWORK: opts.network,
    NEAR_RPC_URL: rpcUrl,
    RELAYER_ACCOUNT_ID: d.relayer,
    RELAYER_PRIVATE_KEY: accountKey,
    REGISTRY_ID: d.registry,
    CAP_VAULT_ID: d.capVault,
    DROP_VAULT_ID: d.dropVault,
    TOKEN_ID: d.token,
    ATTESTATION_ID: d.attestation,
    TOKEN_IS_MOCK: String(d.tokenIsMock),
    RELAYER_ACCOUNTS_PER_IP_DAY: process.env.RELAYER_ACCOUNTS_PER_IP_DAY ?? "5",
  });
  await waitFor("http://localhost:8083/health");
  run("notifier", [tsx, "notifier/src/server.ts"], {
    ...common,
    PORT: "8084",
    NEAR_RPC_URL: rpcUrl,
    REGISTRY_ID: d.registry,
    ATTESTATION_ID: d.attestation,
    SITE_URL: site,
    ORACLE_URL: "http://localhost:8081",
    ...(process.env.NOTIFIER_DATA_FILE ? { NOTIFIER_DATA_FILE: process.env.NOTIFIER_DATA_FILE } : {}),
  });
  await waitFor("http://localhost:8084/health");
  const webEnv = {
    CAPFARE_NETWORK: opts.network,
    NEAR_RPC_URL: rpcUrl,
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
    RAMP_PRIVATE_KEY: accountKey,
    CAPFARE_DEMO: "true",
    SITE_URL: site,
    ...(skyline ? { SKYLINE_URL: skyline } : {}),
  };
  writeFileSync(join(ROOT_DIR, "web", ".env.local"), Object.entries(webEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  console.log(`stack ready (${opts.network}): oracle :8081, verifier :8082, relayer :8083, notifier :8084; web env written to web/.env.local`);
  if (opts.web) {
    run("web", ["pnpm", "--filter", "web", "exec", "next", "start", "-p", String(opts.webPort)], { ...webEnv, PORT: String(opts.webPort) });
    await waitFor(`http://localhost:${opts.webPort}/api/health`, 120);
    console.log(`web: http://localhost:${opts.webPort}`);
  }
  const stop = async () => {
    for (const p of procs) p.kill("SIGTERM");
    await sandbox?.tearDown().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return { deployment: d, stop };
}

/** Testnet: the running services must sign with the keys the attestation contract accepts. */
async function checkKeys(d: Deployment, rpcUrl: string) {
  const chain = new Chain(rpcUrl, "testnet");
  const keys = await chain.view<[string, { service: string; active?: boolean }][]>(d.attestation, "get_keys");
  for (const url of ["http://localhost:8081", "http://localhost:8082"]) {
    const info = await fetchEnclave(url);
    if (!keys.some(([k]) => k === info.signing_public_key)) {
      throw new Error(`${info.service} signs with ${info.signing_public_key}, which is not registered in ${d.attestation}; check ORACLE_DEV_SEED / VERIFIER_DEV_SEED`);
    }
  }
}

if (process.argv[1]?.endsWith("stack.ts")) {
  const network = (process.argv.includes("--testnet") || process.env.CAPFARE_NETWORK === "testnet" ? "testnet" : "sandbox") as StackOptions["network"];
  stack({ web: process.argv.includes("--web"), webPort: Number(process.env.WEB_PORT ?? 3000), network }).catch((e) => {
    console.error(e);
    for (const p of procs) p.kill("SIGTERM");
    process.exit(1);
  });
}
