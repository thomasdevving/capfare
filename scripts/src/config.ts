import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEPLOY_DIR = join(ROOT_DIR, "deployments");

export interface Deployment {
  network: "sandbox" | "testnet";
  rpcUrl: string;
  root: string;
  relayer: string;
  fee: string;
  token: string;
  tokenIsMock: boolean;
  attestation: string;
  registry: string;
  capVault: string;
  dropVault: string;
  demo: boolean;
  deployedAt: string;
  services?: { oracle?: string; verifier?: string; relayer?: string };
}

export function loadDeployment(network: string): Deployment {
  const p = join(DEPLOY_DIR, `${network}.json`);
  if (!existsSync(p)) throw new Error(`no deployment at ${p}; run the deploy script first`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveDeployment(d: Deployment) {
  writeFileSync(join(DEPLOY_DIR, `${d.network}.json`), JSON.stringify(d, null, 2));
}

export function wasm(name: string): string {
  const p = join(ROOT_DIR, "contracts", "target", "near", name, `${name}.wasm`);
  if (!existsSync(p)) throw new Error(`missing ${p}: run ./scripts/build-contracts.sh`);
  return p;
}

export function loadParams(file: string): Record<string, unknown> {
  const j = JSON.parse(readFileSync(file, "utf8"));
  delete j._meta;
  return j;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
