/**
 * Builds the unpacked extension into extension/build.
 *   CAPFARE_APP_URL=https://capfare.example pnpm --filter @capfare/extension build
 * Required host permission: the CapFare app origin only (API + demo booking site).
 * Other sites: the current tab when the user presses "Check this page" (activeTab), or every
 * https site once they turn on automatic checks (optional host permission, asked at that moment).
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build");
const app = (process.env.CAPFARE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const origin = new URL(app).origin;
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { background: join(root, "src/background.ts"), content: join(root, "src/content.ts"), popup: join(root, "src/popup.ts") },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: out,
  define: { __APP_URL__: JSON.stringify(app) },
  minify: false,
});
cpSync(join(root, "static/popup.html"), join(out, "popup.html"));

const manifest = {
  manifest_version: 3,
  name: "CapFare (testnet)",
  version: "0.1.0",
  description: "Lock a maximum price on the flight you're looking at, on any airline or travel site. Testnet prototype.",
  permissions: ["activeTab", "scripting", "storage"],
  host_permissions: [`${origin}/*`],
  optional_host_permissions: ["https://*/*"],
  background: { service_worker: "background.js" },
  content_scripts: [{ matches: [`${origin}/booker*`], js: ["content.js"], run_at: "document_idle" }],
  action: { default_title: "CapFare", default_popup: "popup.html" },
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`extension built for ${app} -> ${out}`);
