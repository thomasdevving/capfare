/**
 * Deploys CapFare to a local sandbox or NEAR testnet (never mainnet).
 *
 *   NETWORK=sandbox|testnet RPC_URL=... ROOT_ACCOUNT=... ROOT_KEY=ed25519:...
 *   PARAMS_FILE=backtest/output/demo_params.json DEMO=true
 *   ORACLE_URL=http://localhost:8081 VERIFIER_URL=http://localhost:8082
 *   pnpm --filter @capfare/scripts deploy
 *
 * Testnet needs a funded root account (~25 NEAR: contract storage ~13 NEAR + seeds).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyPairString } from "near-api-js";
import { Chain, NEAR, newKey } from "./chain.ts";
import { DEPLOY_DIR, loadParams, ROOT_DIR, saveDeployment, sleep, wasm, type Deployment } from "./config.ts";
import { fetchEnclave, registerEnclaveKey } from "./register-keys.ts";

const USDC = 1_000_000n;

export interface DeployOptions {
  network: "sandbox" | "testnet";
  rpcUrl: string;
  root: string;
  rootKey: KeyPairString;
  paramsFile: string;
  demo: boolean;
  oracleUrl?: string;
  verifierUrl?: string;
  existingToken?: string; // e.g. Circle testnet USDC; default deploys the mock token
  /** Deploy under `<prefix>.<root>` (e.g. v2.capfare.testnet) so a new version sits next to the old one. */
  prefix?: string;
  /** Called with the contract accounts' full-access key (keep it: it is needed to upgrade them). */
  onContractsKey?: (key: KeyPairString, parent: string) => void;
  epochSecs?: number;
  keyTimelockSecs?: number;
  seedUsdc?: bigint;
  log?: (m: string) => void;
}

export async function deploy(o: DeployOptions): Promise<Deployment> {
  const log = o.log ?? console.log;
  const chain = new Chain(o.rpcUrl, o.network);
  chain.account(o.root, o.rootKey);
  const key = newKey();
  if (o.network === "sandbox") writeFileSync(join(DEPLOY_DIR, "sandbox.keys.json"), JSON.stringify({ contracts: key, root: o.rootKey }, null, 2));
  const parent = o.prefix ? await chain.createSub(o.root, o.prefix, 24n * NEAR, key) : o.root;
  o.onContractsKey?.(key, parent);
  const sub = (p: string, near: number) => chain.createSub(parent, p, BigInt(near) * NEAR, key);
  log("creating contract accounts");
  const token = o.existingToken ?? (await sub("usdc", 3));
  const attestation = await sub("att", 4);
  const registry = await sub("registry", 6);
  const capVault = await sub("cap", 4);
  const dropVault = await sub("drop", 4);
  const params = loadParams(o.paramsFile);
  const epochSecs = o.epochSecs ?? (o.demo ? 30 : 7 * 86_400);
  const keyTimelock = o.keyTimelockSecs ?? (o.demo ? 5 : 2 * 86_400);

  log("deploying contracts");
  if (!o.existingToken) await chain.deploy(token, wasm("capfare_mock_ft"), { owner: o.root, faucet_amount: (100n * USDC).toString() });
  await chain.deploy(attestation, wasm("capfare_attestation_registry"), {
    owner: o.root, registry, key_timelock_secs: keyTimelock, allow_demo_sources: o.demo, max_snapshot_submit_age_secs: 7_200,
  });
  for (const [v, name] of [[capVault, "cap_vault"], [dropVault, "drop_vault"]] as const) {
    await chain.deploy(v, wasm("capfare_vault"), {
      owner: o.root, name, token, registry, fee_account: o.root, epoch_secs: epochSecs, min_deposit: USDC.toString(),
    });
  }
  await chain.deploy(registry, wasm("capfare_policy_registry"), { owner: o.root, token, attestation, cap_vault: capVault, drop_vault: dropVault, params });

  log("registering token storage");
  for (const a of [registry, capVault, dropVault, o.root]) {
    await chain.call(o.root, token, "storage_deposit", { account_id: a, registration_only: true }, 12_500_000_000_000_000_000_000n, 30);
  }

  const seed = o.seedUsdc ?? 20_000n * USDC;
  if (!o.existingToken) {
    log(`seeding vaults with ${seed / USDC} test USDC each (mock token)`);
    await chain.call(o.root, token, "mint", { account_id: o.root, amount: (2n * seed + 10_000n * USDC).toString() });
    for (const v of [capVault, dropVault]) {
      await chain.call(o.root, token, "ft_transfer_call", { receiver_id: v, amount: seed.toString(), msg: '"deposit"' }, 1n);
    }
    log(`waiting ${epochSecs}s for the first epoch to end`);
    await sleep((epochSecs + 2) * 1000);
    for (const v of [capVault, dropVault]) await chain.call(o.root, v, "roll_epoch", {});
  }

  for (const [label, url] of [["price_oracle", o.oracleUrl], ["booking_verifier", o.verifierUrl]] as const) {
    if (!url) continue;
    const info = await fetchEnclave(url);
    log(`${label}: ${await registerEnclaveKey(chain, o.root, attestation, info, { allowDev: o.demo })}`);
  }

  const d: Deployment = {
    network: o.network,
    rpcUrl: o.rpcUrl,
    root: o.root,
    relayer: o.root,
    fee: o.root,
    token,
    tokenIsMock: !o.existingToken,
    attestation,
    registry,
    capVault,
    dropVault,
    demo: o.demo,
    deployedAt: new Date().toISOString(),
    services: { oracle: o.oracleUrl, verifier: o.verifierUrl },
  };
  saveDeployment(d);
  log(`deployment written to deployments/${o.network}.json`);
  return d;
}

if (process.argv[1] && /(^|[\\/])deploy\.ts$/.test(process.argv[1])) {
  const env = process.env;
  const network = (env.NETWORK ?? "sandbox") as "sandbox" | "testnet";
  if (network !== "sandbox" && network !== "testnet") throw new Error("NETWORK must be sandbox or testnet");
  const paramsFile = env.PARAMS_FILE ?? join(ROOT_DIR, "backtest/output/demo_params.json");
  if (!existsSync(paramsFile)) throw new Error(`missing ${paramsFile}`);
  deploy({
    network,
    rpcUrl: env.RPC_URL ?? "https://test.rpc.fastnear.com",
    root: env.ROOT_ACCOUNT!,
    rootKey: env.ROOT_KEY as KeyPairString,
    paramsFile,
    demo: env.DEMO !== "false",
    oracleUrl: env.ORACLE_URL,
    verifierUrl: env.VERIFIER_URL,
    existingToken: env.TOKEN_ID,
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
