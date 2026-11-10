/**
 * Collects real NEAR testnet evidence for the "How CapFare uses NEAR" chapter and writes
 * video/film/evidence.js. Run after the takes (it uses the recording profile's account):
 *
 *   node video/record/evidence.cjs
 *
 * 1. Buys one Price Cap through the web app (gasless, via the relayer) and keeps the tx hash.
 * 2. Reads that transaction with EXPERIMENTAL_tx_status: the outer transaction (relayer pays),
 *    the delegate action (the user's signed call) and every receipt in execution order.
 * 3. Reads the user's account, the service keys registered in the attestation registry, and
 *    the contract list from deployments/testnet.json.
 * Nothing here is typed in by hand: what the film shows is what the chain returned.
 */
const fs = require("fs");
const path = require("path");
const { openBrowser, sleep, APP, FOOTAGE, ROOT } = require("./lib.cjs");

const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const DEP = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "testnet.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(FOOTAGE, "state.json"), "utf8"));

async function rpc(method, params) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json().catch(() => ({}));
    if (j.result) return j.result;
    await sleep(2000 * (i + 1));
    if (i === 5) throw new Error(`${method}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  }
}
const view = async (account_id, method_name, args = {}) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
};
const short = (id) => id.replace(/\.capfare\.testnet$/, "").replace(/^(\w+)\.v2$/, "$1.v2");

async function buyOne() {
  const ctx = await openBrowser(path.join(__dirname, "..", process.env.REC_PROFILE ?? ".profile-main"));
  try {
    const page = ctx.pages()[0];
    const relays = [];
    page.on("response", async (r) => {
      if (r.url().endsWith("/api/relay")) relays.push(await r.json().catch(() => null));
    });
    await page.goto(`${APP}/quote?fn=IB1131&date=2027-06-21&from=BCN&to=AMS&fare=economy_standard`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Get a quote" }).click();
    await page.getByText(/Verified airline price/).first().waitFor({ timeout: 120_000 });
    await sleep(800);
    const slider = page.locator("#cap");
    if (await slider.count()) await slider.fill((await slider.getAttribute("max")) ?? "30000");
    await page.getByLabel(/Lead passenger.s last name/).fill("de Vries");
    await page.getByRole("button", { name: /^Lock / }).click();
    await page.getByText(/Protection(s)? #\d+/).first().waitFor({ timeout: 180_000 });
    await sleep(1000);
    const r = relays.filter(Boolean).find((x) => x.tx_hash && x.ok);
    if (!r) throw new Error("no relayed transaction seen");
    return r.tx_hash;
  } finally {
    await ctx.close();
  }
}

(async () => {
  const hash = process.argv[2] ?? (await buyOne());
  console.log("tx", hash);
  const relayer = DEP.relayer;
  const tx = await rpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: relayer, wait_until: "FINAL" });
  const t = tx.transaction;
  const del = t.actions.find((a) => a.Delegate)?.Delegate?.delegate_action;
  const fc = del?.actions?.find((a) => a.FunctionCall)?.FunctionCall;
  const byId = Object.fromEntries(tx.receipts.map((r) => [r.receipt_id, r]));
  const receipts = [];
  for (const o of tx.receipts_outcome) {
    const r = byId[o.id];
    if (!r || r.predecessor_id === "system") continue;
    const calls = (r.receipt.Action?.actions ?? []).filter((a) => a.FunctionCall).map((a) => a.FunctionCall);
    for (const c of calls) {
      const failed = !!o.outcome.status.Failure;
      receipts.push({ from: r.predecessor_id, to: r.receiver_id, method: c.method_name, args: (() => { try { return JSON.parse(Buffer.from(c.args, "base64").toString()); } catch { return null; } })(), failed });
    }
  }
  const ft = receipts.find((r) => r.method === "ft_transfer_call");
  const block = await rpc("block", { block_id: tx.transaction_outcome.block_hash });
  const when = new Date(block.header.timestamp / 1e6).toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const pk = state.pkAccount ?? "anna-devries.capfare.testnet";
  const acct = await rpc("query", { request_type: "view_account", finality: "final", account_id: pk });
  const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: pk });
  const svc = await view(DEP.attestation, "get_keys");

  const contracts = [DEP.registry, DEP.capVault, DEP.dropVault, DEP.attestation, DEP.token].filter(Boolean);
  const E = {
    collectedAt: new Date().toISOString(),
    rpc: RPC,
    metaTx: {
      hash,
      when,
      signer: t.signer_id,
      receiverOuter: t.receiver_id,
      inner: del?.sender_id,
      receiver: del?.receiver_id,
      method: fc?.method_name,
      gasBurnt: tx.transaction_outcome.outcome.gas_burnt,
      tokensBurnt: tx.transaction_outcome.outcome.tokens_burnt,
    },
    receipts: receipts.map((r) => [short(r.from), short(r.to), r.method]),
    ftCall: ft ? { from: ft.from, token: ft.to, vault: ft.args?.receiver_id, amount: ft.args?.amount, tusdc: (Number(ft.args?.amount) / 1e6).toFixed(2), policy: (() => { try { const m = JSON.parse(ft.args?.msg); return m.policy?.policy_id ?? m.policy_id ?? null; } catch { return null; } })() } : null,
    accounts: [pk, state.main].filter(Boolean),
    accountView: { id: pk, storage: acct.storage_usage, key: keys.keys[0]?.public_key?.slice(0, 22) + "…", parent: "capfare.testnet" },
    serviceKeys: svc.map(([h, k]) => ({ role: k.service === "price_oracle" ? "oracle" : "verifier", key: h.slice(0, 16) + "…", registeredAt: k.registered_at })),
    verifyFile: "contracts/attestation_registry/src/lib.rs",
    contracts,
  };
  const out = path.join(__dirname, "..", "film", "evidence.js");
  fs.writeFileSync(out, `// Generated by video/record/evidence.cjs from NEAR testnet RPC (${RPC}) on ${E.collectedAt}.\n// Do not edit by hand: rerun the script.\nwindow.EVIDENCE = ${JSON.stringify(E, null, 1)};\n`);
  console.log(JSON.stringify(E, null, 1));
  console.log("wrote", out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
