/** NEP-366 meta-transaction relayer for CapFare (testnet). */
import { fileURLToPath } from "node:url";
import { NearViewClient } from "@capfare/shared";
import { logger, serve } from "@capfare/tee-common";
import { routes } from "./app.ts";
import { nearChain } from "./near.ts";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function main() {
  if ((process.env.NEAR_NETWORK ?? "testnet") !== "testnet" && process.env.NEAR_NETWORK !== "sandbox") {
    throw new Error("CapFare relayer only runs on testnet or sandbox");
  }
  const rpc = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
  const cfg = {
    relayerId: req("RELAYER_ACCOUNT_ID"),
    registry: req("REGISTRY_ID"),
    capVault: req("CAP_VAULT_ID"),
    dropVault: req("DROP_VAULT_ID"),
    token: req("TOKEN_ID"),
    attestation: req("ATTESTATION_ID"),
    allowFaucet: process.env.TOKEN_IS_MOCK === "true",
    maxGasPerAction: 300_000_000_000_000n,
    newAccountNearYocto: BigInt(process.env.NEW_ACCOUNT_YOCTO ?? "50000000000000000000000"), // 0.05 NEAR
  };
  const chain = nearChain(rpc, cfg.relayerId, req("RELAYER_PRIVATE_KEY"));
  serve({
    port: Number(process.env.PORT ?? 8083),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
    log: logger("relayer"),
    routes: routes(cfg, chain, new NearViewClient({ rpcUrl: rpc })),
  });
  logger("relayer")("started", { relayer: cfg.relayerId, rpc });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
