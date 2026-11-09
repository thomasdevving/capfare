import { describe, expect, it } from "vitest";
import { actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, KeyPair, KeyType, Signature } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { routes } from "../src/app.ts";
import { checkDelegate, Quota, validSubName } from "../src/policy.ts";
import { decodeSignedDelegate, viewDelegate, type ChainOps } from "../src/near.ts";

const cfg = {
  relayerId: "capfare.testnet", registry: "registry.capfare.testnet", capVault: "cap.capfare.testnet", dropVault: "drop.capfare.testnet",
  token: "usdc.capfare.testnet", attestation: "att.capfare.testnet", allowFaucet: true, maxGasPerAction: 300_000_000_000_000n,
  newAccountNearYocto: 1n,
};

function signed(receiverId: string, method: string, args: object, deposit = 0n) {
  const kp = KeyPair.fromRandom("ed25519");
  const da = buildDelegateAction({
    senderId: "alice.capfare.testnet",
    receiverId,
    actions: [actions.functionCall(method, args, 100_000_000_000_000n, deposit)],
    nonce: 1n,
    maxBlockHeight: 1000n,
    publicKey: kp.getPublicKey(),
  });
  const msg = encodeDelegateAction(da);
  const sig = kp.sign(sha256(msg)).signature;
  const sd = { delegateAction: da, signature: new Signature({ keyType: KeyType.ED25519, data: sig }) } as any;
  return Buffer.from(encodeSignedDelegate(sd)).toString("base64");
}

const chain = (): ChainOps & { relayed: number } => {
  const c = {
    relayed: 0,
    async relay() { c.relayed++; return { hash: "h", ok: true }; },
    async createUser() {},
    async registerOnToken() {},
    async submitSnapshots(_a: string, s: unknown[]) { return s.map(() => "ok"); },
  };
  return c;
};

const req = { headers: {}, socket: { remoteAddress: "1.2.3.4" } } as any;

describe("relayer policy", () => {
  it("decodes and sponsors an allowlisted purchase", async () => {
    const c = chain();
    const r = routes(cfg, c);
    const out: any = await r["POST /v1/relay"]({ signed_delegate: signed(cfg.registry, "buy_cap", { strike_minor: 18000 }) }, req);
    expect(out.ok).toBe(true);
    expect(c.relayed).toBe(1);
  });

  it("refuses unknown receivers, methods and deposits", () => {
    const v = (s: string) => viewDelegate(decodeSignedDelegate(s));
    expect(checkDelegate(v(signed("evil.testnet", "buy_cap", {})), cfg)).toMatch(/not sponsored/);
    expect(checkDelegate(v(signed(cfg.registry, "propose_params", {})), cfg)).toMatch(/not sponsored/);
    expect(checkDelegate(v(signed(cfg.registry, "buy_cap", {}, 5n)), cfg)).toMatch(/no deposit/);
    expect(checkDelegate(v(signed(cfg.token, "ft_transfer_call", { receiver_id: "evil.testnet" }, 1n)), cfg)).toMatch(/only to CapFare/);
    expect(checkDelegate(v(signed(cfg.token, "ft_transfer_call", { receiver_id: cfg.registry, msg: "\"top_up\"" }, 1n)), cfg)).toBeNull();
    expect(checkDelegate(v(signed(cfg.token, "ft_transfer", { receiver_id: cfg.registry }, 1n)), cfg)).toMatch(/not sponsored/);
  });

  it("rate-limits per account", async () => {
    const c = chain();
    const r = routes(cfg, c);
    let blocked = false;
    for (let i = 0; i < 45; i++) {
      try {
        await r["POST /v1/relay"]({ signed_delegate: signed(cfg.registry, "expire", { policy_id: i }) }, { ...req, socket: { remoteAddress: `10.0.0.${i}` } });
      } catch (e: any) {
        blocked = /too many/.test(e.message);
      }
    }
    expect(blocked).toBe(true);
  });

  it("validates account names", () => {
    expect(validSubName("alice")).toBe(true);
    expect(validSubName("Al")).toBe(false);
    expect(validSubName("a--b")).toBe(false);
    expect(new Quota(1, 1000).hit("x")).toBe(true);
  });

  it("only submits correctly signed snapshots", async () => {
    const r = routes(cfg, chain());
    await expect(r["POST /v1/snapshots"]({ snapshots: [{ snapshot: { flight_key_hash: "00".repeat(32), price_minor: 1, currency: "EUR", available: true, signals: { momentum_bucket: 2, availability_bucket: 0, season_flag: false }, departure_ts: 2, observed_at: 1, source_id: "demo", enclave_measurement: "00".repeat(32) }, signer: "00".repeat(32), signature: "00".repeat(64) }] }, req)).rejects.toThrow(/registered oracle key/);
  });
});
