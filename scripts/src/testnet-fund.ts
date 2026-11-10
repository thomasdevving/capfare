/**
 * Funds a CapFare testnet root account from the public testnet faucet (no mainnet, no real money).
 * The faucet creates `<name>.testnet` accounts with a fixed balance; extra faucet accounts are
 * deleted with the root as beneficiary, which moves their balance to the root.
 *
 *   NODE_USE_ENV_PROXY=1 (behind an HTTPS proxy)
 *   ROOT_NAME=capfare.testnet TARGET_NEAR=35 pnpm --filter @capfare/scripts exec tsx src/testnet-fund.ts
 *
 * Keys are written to deployments/testnet.keys.json (git-ignored, mode 600). Never commit it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString } from "near-api-js";
import { DEPLOY_DIR, sleep } from "./config.ts";
import { NEAR } from "./chain.ts";

const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const FAUCETS = ["https://helper.nearprotocol.com/account", "https://helper.testnet.near.org/account"];
export const KEYS_FILE = join(DEPLOY_DIR, "testnet.keys.json");

export interface TestnetKeys {
  root?: { account: string; key: KeyPairString };
  [k: string]: unknown;
}

export const loadKeys = (): TestnetKeys => (existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : {});
export const saveKeys = (k: TestnetKeys) => writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2), { mode: 0o600 });

async function faucetAccount(prefix: string, exact?: string): Promise<{ account: string; key: KeyPairString }> {
  const kp = KeyPair.fromRandom("ed25519");
  const account = exact ?? `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}.testnet`;
  let last = "";
  for (const url of FAUCETS) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: account, newAccountPublicKey: kp.getPublicKey().toString() }) });
    if (r.ok) return { account, key: kp.toString() as KeyPairString };
    last = `${url}: ${r.status} ${(await r.text()).slice(0, 200)}`;
  }
  throw new Error(`faucet refused: ${last}`);
}

async function balance(provider: JsonRpcProvider, id: string): Promise<bigint> {
  for (let i = 0; i < 20; i++) {
    try {
      const a = (await provider.viewAccount({ accountId: id } as never)) as unknown as { amount: string };
      return BigInt(a.amount);
    } catch {
      await sleep(1500); // the account appears a block or two after the faucet answers
    }
  }
  throw new Error(`${id} not found`);
}

/** `rootName`: a readable root such as capfare.testnet, if still free (contracts live under it). */
export async function fund(targetNear: number, rootName?: string, log = console.log): Promise<{ account: string; key: KeyPairString }> {
  const provider = new JsonRpcProvider({ url: RPC });
  const keys = loadKeys();
  if (!keys.root || (rootName && keys.root.account !== rootName)) {
    const old = keys.root;
    keys.root = await faucetAccount("capfare", rootName);
    saveKeys(keys);
    log(`root account ${keys.root.account}`);
    if (old) {
      await balance(provider, keys.root.account);
      await new Account(old.account, provider, KeyPairSigner.fromSecretKey(old.key)).deleteAccount(keys.root.account);
      log(`merged ${old.account} into the root`);
    }
  }
  const root = keys.root;
  let have = await balance(provider, root.account);
  log(`root balance ${Number(have / 10n ** 21n) / 1000} NEAR`);
  for (let i = 0; have < BigInt(targetNear) * NEAR && i < 12; i++) {
    const extra = await faucetAccount("capfare-fund");
    await balance(provider, extra.account);
    const acc = new Account(extra.account, provider, KeyPairSigner.fromSecretKey(extra.key));
    await acc.deleteAccount(root.account);
    have = await balance(provider, root.account);
    log(`merged ${extra.account}: root now ${Number(have / 10n ** 21n) / 1000} NEAR`);
  }
  if (have < BigInt(targetNear) * NEAR) throw new Error(`only ${have / NEAR} NEAR after 12 faucet accounts`);
  return root;
}

if (process.argv[1]?.endsWith("testnet-fund.ts")) {
  fund(Number(process.env.TARGET_NEAR ?? 35), process.env.ROOT_NAME).then((r) => console.log(`funded ${r.account}`)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
