/**
 * Scripted demo (brief section 13) against a running stack (see stack.ts / demo.sh).
 * Prices move because the DEMO price adapter replays a scripted path — this is labelled
 * everywhere. All user actions are gasless meta-transactions via the relayer.
 */
import { boxKeyFromSeed, capPayout, dropPayout, formatEur, formatUsdc, sealJson, type FlightKey, type Params, type Policy, type VaultState } from "@capfare/shared";
import { Chain } from "./chain.ts";
import { loadDeployment, sleep } from "./config.ts";
import { GaslessUser } from "./user.ts";

void boxKeyFromSeed;
const ORACLE = process.env.ORACLE_URL ?? "http://localhost:8081";
const VERIFIER = process.env.VERIFIER_URL ?? "http://localhost:8082";
const RELAYER = process.env.RELAYER_URL ?? "http://localhost:8083";

const CAP_FLIGHT: FlightKey = { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };
const DROP_FLIGHT: FlightKey = { ...CAP_FLIGHT, fare_class: "economy_standard" };

const say = (s: string) => console.log(`\n▸ ${s}`);
const kv = (k: string, v: unknown) => console.log(`    ${k.padEnd(28)} ${v}`);

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(`${url}: ${j.error}`);
  return j;
}

async function pushPrice(flight: FlightKey, step: number) {
  await post(`${ORACLE}/v1/demo/advance`, { flight_key: flight, to: step });
  const r = await post<{ snapshot: { snapshot: { price_minor: number } }; submitted: string }>(`${ORACLE}/v1/snapshot`, { flight_key: flight });
  kv("oracle snapshot (demo source)", `${formatEur(r.snapshot.snapshot.price_minor)} → ${r.submitted}`);
  await sleep(1200);
}

async function verifyEml(flight: FlightKey, paid: number, refundable: "non_refundable" | "refundable", bookedAt: number) {
  const enclave = await (await fetch(`${VERIFIER}/v1/enclave`)).json() as { box_public_key: string };
  const fx = await post<{ eml_base64: string; booking_ref: string; last_name: string }>(`${VERIFIER}/v1/demo/fixture`, {
    flight_key: flight, fare_label: flight.fare_class === "economy_light" ? "Economy Light" : "Economy Standard",
    paid_price_minor: paid, refundable, booked_at: bookedAt,
  });
  const sealed = await sealJson({ eml_base64: fx.eml_base64, flight_key: flight }, enclave.box_public_key);
  const v = await post<{ attestation: any }>(`${VERIFIER}/v1/verify/eml`, { sealed });
  return { attestation: v.attestation, booking_ref: fx.booking_ref, last_name: fx.last_name, box: enclave.box_public_key };
}

async function vaultLine(chain: Chain, id: string, label: string) {
  const s = await chain.view<VaultState>(id, "get_state");
  kv(`${label} total assets`, `${formatUsdc(s.total_assets)} tUSDC`);
  kv(`${label} locked coverage`, `${formatUsdc(s.locked_coverage)} tUSDC`);
  kv(`${label} pending withdrawals`, `${formatUsdc(s.pending_withdrawals)} tUSDC`);
  kv(`${label} invariant`, `${s.invariant_ok ? "OK" : "VIOLATED"}  (total_assets ≥ locked + pending)`);
  return s;
}

async function waitPolicy(chain: Chain, registry: string, id: number, states: string[], timeoutMs = 30_000): Promise<Policy> {
  const t0 = Date.now();
  for (;;) {
    const p = await chain.view<Policy>(registry, "get_policy", { policy_id: id });
    if (p && states.includes(p.state) && !p.busy) return p;
    if (Date.now() - t0 > timeoutMs) throw new Error(`policy ${id} stuck in ${p?.state}`);
    await sleep(800);
  }
}

export async function demo(network = process.env.NETWORK ?? "sandbox") {
  const d = loadDeployment(network);
  const chain = new Chain(d.rpcUrl, d.network);
  const params = await chain.view<Params>(d.registry, "get_params");
  console.log("CapFare demo — network:", d.network, "| prices are SCRIPTED (demo adapter), not live airline data");

  say("1. Contracts deployed, demo enclave keys registered, vaults seeded");
  const keys = await chain.view<[string, { service: string }][]>(d.attestation, "get_keys");
  kv("registered enclave keys", keys.map(([k, v]) => `${v.service}:${k.slice(0, 10)}…`).join(", "));
  await vaultLine(chain, d.capVault, "cap_vault");

  say("2. New traveller: named account, gasless; test USDC from the faucet, prepaid credit top-up (80 tUSDC)");
  const user = await GaslessUser.create(`traveller${Date.now() % 100000}`, d.rpcUrl, RELAYER);
  kv("account", user.accountId);
  await user.call(d.token, "faucet", {});
  await user.call(d.token, "ft_transfer_call", { receiver_id: d.registry, amount: (80n * 1_000_000n).toString(), msg: '"top_up"' }, 1n);
  kv("credit balance", `${formatUsdc(await chain.view<string>(d.registry, "get_credit", { account_id: user.accountId }))} tUSDC`);

  say("3. Quote: KL1695 AMS→BCN 14 Jun 2027, Economy Light — price now €170, cap €180");
  await pushPrice(CAP_FLIGHT, 0);
  const fkh = await chain.view<string>(d.registry, "flight_key_hash", { flight_key: CAP_FLIGHT });
  const snap = await chain.view<any>(d.attestation, "get_latest_snapshot", { flight_key_hash: fkh });
  const vs = await chain.view<VaultState>(d.capVault, "get_state");
  const now = await chain.nowSecs();
  const lock = BigInt(params.cap.max_payout) * BigInt(params.global.usdc_micro_per_cent);
  const exposure = (await chain.view<[number, number]>(d.registry, "get_flight_exposure", { product: "cap", flight_key_hash: fkh }))[0];
  const quote = await chain.view<any>(d.registry, "preview_premium", {
    inputs: { product: "cap", current_price: snap.price_minor, strike: 18000, signals: snap.signals, now, departure_ts: snap.departure_ts,
      vault_total_assets: vs.total_assets, vault_locked: vs.locked_coverage, vault_reserved: vs.pending_withdrawals, new_lock: lock.toString(), flight_exposure: exposure },
  });
  kv("premium (on-chain formula)", formatEur(quote.premium));
  kv("deductible / max payout", `${formatEur(params.cap.deductible)} / ${formatEur(params.cap.max_payout)}`);
  kv("activation delay", `${params.cap.activation_delay_secs}s (demo timing)`);

  say("4. Buy the Price Cap (premium debited from credit, max payout locked in cap_vault)");
  const stats0 = await chain.view<{ policies_total: number }>(d.registry, "get_stats");
  await user.call(d.registry, "buy_cap", { flight_key: CAP_FLIGHT, strike_minor: 18000, max_premium_minor: quote.premium + 200 });
  const capId = stats0.policies_total + 1;
  const pol = await waitPolicy(chain, d.registry, capId, ["active"]);
  kv("policy", `#${capId} ${pol.state}, premium ${formatEur(pol.premium_minor)}, lock ${formatUsdc(pol.lock_usdc)} tUSDC`);
  await vaultLine(chain, d.capVault, "cap_vault");

  say("5. After the activation delay the (scripted) price rises to €260");
  while ((await chain.nowSecs()) < pol.active_from + 1) await sleep(1000);
  await pushPrice(CAP_FLIGHT, 1);
  await pushPrice(CAP_FLIGHT, 2);
  await pushPrice(CAP_FLIGHT, 3);

  say("6. Traveller books at €255 and uploads the confirmation (fixture .eml, DKIM-verified in the enclave)");
  const booked = await chain.nowSecs();
  const cap = await verifyEml(CAP_FLIGHT, 25500, "non_refundable", booked);
  kv("attestation", `paid ${formatEur(cap.attestation.attestation.paid_price_minor)}, ${cap.attestation.attestation.refundable}, no PII`);
  await user.call(d.registry, "claim_cap", { policy_id: capId, attestation: cap.attestation });

  say("7. Payout = min(260, 255) − 180 − deductible, capped at max payout");
  const paid = await waitPolicy(chain, d.registry, capId, ["paid_out", "claimed", "active"]);
  const expected = capPayout(26000, 25500, 18000, params.cap.deductible, params.cap.max_payout);
  kv("index at booking", formatEur(paid.index_at_booking_minor ?? 0));
  kv("payout", `${formatEur(paid.payout_minor ?? 0)} (expected ${formatEur(expected)}) → state ${paid.state}`);
  kv("traveller USDC balance", `${formatUsdc(await chain.view<string>(d.token, "ft_balance_of", { account_id: user.accountId }))} tUSDC`);
  await vaultLine(chain, d.capVault, "cap_vault");

  say("8. Drop Guarantee: booked at €220, price falls to €195 within the window");
  await pushPrice(DROP_FLIGHT, 0);
  const b2 = await chain.nowSecs();
  const drop = await verifyEml(DROP_FLIGHT, 22000, "non_refundable", b2);
  const stats1 = await chain.view<{ policies_total: number }>(d.registry, "get_stats");
  await user.call(d.registry, "buy_drop", { attestation: drop.attestation, flight_key: DROP_FLIGHT, max_premium_minor: params.drop.max_premium });
  const dropId = stats1.policies_total + 1;
  const dp = await waitPolicy(chain, d.registry, dropId, ["active"]);
  kv("policy", `#${dropId} ${dp.state}, premium ${formatEur(dp.premium_minor)}, window ends in ${dp.expires_at - (await chain.nowSecs())}s`);
  for (const s of [1, 2, 3]) await pushPrice(DROP_FLIGHT, s);
  while ((await chain.nowSecs()) < dp.expires_at + 1) await sleep(2000);
  const st = await post<{ attestation: any }>(`${VERIFIER}/v1/verify/status`, {
    sealed: await sealJson({ airline: "KL", booking_ref: drop.booking_ref, last_name: drop.last_name, flight_key: DROP_FLIGHT, booked_at: b2 }, drop.box),
  });
  await user.call(d.registry, "settle_drop", { policy_id: dropId, attestation: st.attestation });
  const dpaid = await waitPolicy(chain, d.registry, dropId, ["paid_out", "claimed", "voided"]);
  kv("lowest price seen", formatEur(dpaid.lowest_price_seen_minor ?? 0));
  kv("payout", `${formatEur(dpaid.payout_minor ?? 0)} (expected ${formatEur(dropPayout(22000, 19500, params.drop.deductible, params.drop.max_payout))}) → ${dpaid.state}`);

  say("9. Vault state and invariant");
  const a = await vaultLine(chain, d.capVault, "cap_vault");
  const b = await vaultLine(chain, d.dropVault, "drop_vault");
  const ok = a.invariant_ok && b.invariant_ok && paid.state === "paid_out" && dpaid.state === "paid_out";
  console.log(ok ? "\nDEMO OK" : "\nDEMO FINISHED WITH ISSUES");
  return ok;
}

if (process.argv[1]?.endsWith("demo.ts")) {
  demo().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
