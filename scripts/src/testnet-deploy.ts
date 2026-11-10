/**
 * One-time CapFare deployment to NEAR testnet (never mainnet), under the root account funded by
 * testnet-fund.ts (e.g. capfare.testnet):
 *   1. development seeds for the price oracle and booking verifier (their public keys are
 *      registered in the attestation contract, timelocked, like enclave keys would be);
 *   2. a separate full-access key on the root for the hosted demo, so it can be revoked on its own;
 *   3. contracts, mock test-USDC, seeded vaults, registered keys (scripts/src/deploy.ts);
 *   4. deployments/testnet.json (public, committed) and deployments/testnet.secrets.json
 *      (git-ignored, mode 600) with the values the hosted demo needs as environment variables.
 *
 *   NODE_USE_ENV_PROXY=1 pnpm --filter @capfare/scripts exec tsx src/testnet-deploy.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { actions, KeyPair, type KeyPairString } from "near-api-js";
import { Chain } from "./chain.ts";
import { DEPLOY_DIR, ROOT_DIR, sleep } from "./config.ts";
import { deploy } from "./deploy.ts";
import { loadKeys, saveKeys } from "./testnet-fund.ts";

const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const procs: ChildProcess[] = [];

async function up(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function main() {
  const keys = loadKeys() as ReturnType<typeof loadKeys> & { oracle_seed?: string; verifier_seed?: string; hosted?: KeyPairString };
  if (!keys.root) throw new Error("no root account: run testnet-fund.ts first");
  keys.oracle_seed ??= randomBytes(32).toString("hex");
  keys.verifier_seed ??= randomBytes(32).toString("hex");
  keys.hosted ??= KeyPair.fromRandom("ed25519").toString() as KeyPairString;
  saveKeys(keys);

  const chain = new Chain(RPC, "testnet");
  chain.account(keys.root.account, keys.root.key);
  const hostedPub = KeyPair.fromString(keys.hosted).getPublicKey().toString();
  const ak = await chain.provider.viewAccessKeyList({ accountId: keys.root.account } as never).catch(() => ({ keys: [] })) as { keys: { public_key: string }[] };
  if (!ak.keys.some((k) => k.public_key === hostedPub)) {
    await chain.account(keys.root.account).signAndSendTransaction({ receiverId: keys.root.account, actions: [actions.addFullAccessKey(KeyPair.fromString(keys.hosted).getPublicKey())] });
    console.log("added the hosted demo's key to the root account");
  }

  // The two services with the testnet seeds, only to read their public keys for registration.
  const tsx = join(ROOT_DIR, "scripts", "node_modules", ".bin", "tsx");
  const env = { ...process.env, CAPFARE_DEPLOYMENT: "demo" };
  procs.push(spawn(tsx, ["tee/price_oracle/src/server.ts"], { cwd: ROOT_DIR, env: { ...env, PORT: "8091", ORACLE_DEV_SEED: keys.oracle_seed }, stdio: "ignore" }));
  procs.push(spawn(tsx, ["tee/booking_verifier/src/server.ts"], { cwd: ROOT_DIR, env: { ...env, PORT: "8092", VERIFIER_DEV_SEED: keys.verifier_seed }, stdio: "ignore" }));
  await up("http://localhost:8091/health");
  await up("http://localhost:8092/health");

  const d = await deploy({
    network: "testnet",
    rpcUrl: RPC,
    root: keys.root.account,
    rootKey: keys.root.key,
    paramsFile: join(ROOT_DIR, "backtest/output/demo_params.json"),
    demo: true,
    oracleUrl: "http://localhost:8091",
    verifierUrl: "http://localhost:8092",
  });
  // The public record must not point at this machine's temporary service ports.
  writeFileSync(join(DEPLOY_DIR, "testnet.json"), JSON.stringify({ ...d, services: undefined, explorer: "https://testnet.nearblocks.io" }, null, 2) + "\n");
  writeFileSync(
    join(DEPLOY_DIR, "testnet.secrets.json"),
    JSON.stringify({ CAPFARE_NETWORK: "testnet", CAPFARE_ACCOUNT_KEY: keys.hosted, ORACLE_DEV_SEED: keys.oracle_seed, VERIFIER_DEV_SEED: keys.verifier_seed }, null, 2),
    { mode: 0o600 },
  );
  console.log(`deployed under ${d.root}; public record deployments/testnet.json; hosting secrets in deployments/testnet.secrets.json (do not commit)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => procs.forEach((p) => p.kill("SIGTERM")));
