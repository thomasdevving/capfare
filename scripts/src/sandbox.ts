/** Starts a local NEAR sandbox and writes its RPC URL + genesis key to deployments/sandbox.rpc.json. */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } from "near-sandbox";

export async function startSandbox(outDir: string) {
  const sandbox = await Sandbox.start({});
  mkdirSync(outDir, { recursive: true });
  const info = { rpcUrl: sandbox.rpcUrl, root: DEFAULT_ACCOUNT_ID, rootKey: DEFAULT_PRIVATE_KEY, network: "sandbox" };
  writeFileSync(`${outDir}/sandbox.rpc.json`, JSON.stringify(info, null, 2));
  return { sandbox, info };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? new URL("../../deployments", import.meta.url).pathname;
  startSandbox(out).then(({ info }) => {
    console.log(`sandbox running at ${info.rpcUrl} (root account "${info.root}")`);
    process.on("SIGINT", () => process.exit(0));
    setInterval(() => {}, 1 << 30);
  });
}
