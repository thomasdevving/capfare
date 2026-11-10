import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { accountRequestMessage, base58Encode, bytesToHex, type Policy, type SnapshotRecord } from "@capfare/shared";
import { Notifier, Store, type Channels, type NotifierOptions, type SettingsAction } from "../src/index.ts";

const T = 1_900_000_000;
const seed = new Uint8Array(32).fill(5);
const PK = `ed25519:${base58Encode(ed25519.getPublicKey(seed))}`;
const flight = { airline: "KL", flight_number: "KL1695", departure_date: "2030-03-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };

function policy(over: Partial<Policy>): Policy {
  return {
    id: 1, owner: "alice.test", product: "cap", flight_key_hash: "aa", coverage: { flight }, seats: 1, strike_minor: 18_000, deductible_minor: 500,
    max_payout_minor: 15_000, premium_minor: 600, purchased_at: T - 3 * 86_400, active_from: T - 2 * 86_400, expires_at: T + 5 * 86_400, departure_ts: T + 30 * 86_400,
    state: "active", booking_nullifier: null, lowest_price_seen_minor: null, index_at_booking_minor: null, paid_price_minor: null, refundable: null, payout_minor: null,
    booked_flight: null, booked_flight_key_hash: null, seats_covered: null, trip_id: null, auto_drop_max_premium_minor: null, linked_policy: null, final_check_at: null,
    usdc_micro_per_cent: 10_800, premium_usdc: "0", lock_usdc: "0", route_week_key: "bb", passenger_commitment: "cc", busy: false, note: null, ...over,
  };
}
const snap = (price: number): SnapshotRecord => ({ price_minor: price, available: true, signals: { momentum_bucket: 2, availability_bucket: 1, season_flag: false }, departure_ts: T + 30 * 86_400, observed_at: T, demo: true });

function harness(extra: Partial<NotifierOptions> = {}) {
  const chain = { policies: [policy({}), policy({ id: 2, state: "paid_out", payout_minor: 7_000 })], price: 17_000 as number | null, keys: new Set([`alice.test|${PK}`]) };
  const pushes: { endpoint: string; title: string; quick_url?: string; quick_action?: string }[] = [];
  const mails: { to: string; subject: string; text: string }[] = [];
  const gone = new Set<string>();
  const channels: Channels = {
    vapidPublicKey: "BPub",
    emailMode: "demo-outbox",
    async push(sub, a) {
      if (gone.has(sub.endpoint)) return "gone";
      pushes.push({ endpoint: sub.endpoint, title: a.title, quick_url: a.quick_url, quick_action: a.quick_action });
      return "ok";
    },
    async mail(to, subject, text, _account) {
      mails.push({ to, subject, text });
      return true;
    },
  };
  const rpc = {
    async view<R>(_c: string, method: string): Promise<R> {
      if (method === "get_policies_by_owner") return chain.policies as R;
      if (method === "get_params") return { global: { claim_grace_secs: 3 * 86_400, sold_out_premium_refund: true } } as R;
      return (chain.price === null ? null : snap(chain.price)) as R;
    },
    async blockTimeSecs() {
      return T;
    },
    async hasAccessKey(a: string, k: string) {
      return chain.keys.has(`${a}|${k}`);
    },
  };
  const store = new Store();
  const n = new Notifier({ store, channels, rpc: rpc as never, registryId: "reg", attestationId: "att", appUrl: "https://app.example", now: () => T, ...extra });
  const req = (payload: SettingsAction, account = "alice.test", ts = T) => ({
    account_id: account, public_key: PK, ts, payload,
    signature: bytesToHex(ed25519.sign(accountRequestMessage("notify", account, ts, payload), seed)),
  });
  return { chain, pushes, mails, gone, store, n, req };
}

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

describe("notifier", () => {
  it("only the account's own key can change its settings", async () => {
    const h = harness();
    await expect(h.n.settings({ ...h.req({ action: "get" }), payload: { action: "remove_email" } })).rejects.toThrow(/bad signature/);
    await expect(h.n.settings(h.req({ action: "get" }, "bob.test"))).rejects.toThrow(/does not belong/);
    await expect(h.n.settings(h.req({ action: "get" }, "alice.test", T - 3600))).rejects.toThrow(/expired/);
    expect(await h.n.settings(h.req({ action: "get" }))).toMatchObject({ push_devices: 0, email: null });
  });

  it("pushes each new alert once, without replaying history", async () => {
    const h = harness();
    await h.n.settings(h.req({ action: "subscribe_push", subscription: SUB }));
    expect(await h.n.tick()).toBe(0); // old payout (#2) was seeded as already known
    h.chain.price = 26_000; // cap #1 is now €80 above the cap
    expect(await h.n.tick()).toBe(1);
    expect(h.pushes.map((p) => p.title)).toEqual(["KL1695 AMS→BCN, 2030-03-14: €80 above your cap"]);
    expect(await h.n.tick()).toBe(0);
    h.chain.price = 29_000; // €30 more back: a new alert
    expect(await h.n.tick()).toBe(1);
  });

  it("drops push subscriptions the browser has revoked", async () => {
    const h = harness();
    await h.n.settings(h.req({ action: "subscribe_push", subscription: SUB }));
    h.gone.add(SUB.endpoint);
    h.chain.price = 26_000;
    await h.n.tick();
    expect(h.store.account("alice.test").push).toEqual([]);
  });

  it("email needs a confirmed address (double opt-in) and is masked in responses", async () => {
    const h = harness();
    const v = await h.n.settings(h.req({ action: "set_email", email: "anna@example.org" }));
    expect(v.email).toEqual({ address: "a…a@example.org", verified: false });
    expect(h.mails).toHaveLength(1);
    const token = /token=([\w-]+)/.exec(h.mails[0].text)![1];
    h.chain.price = 26_000;
    await h.n.tick();
    expect(h.mails).toHaveLength(1); // unconfirmed: nothing sent
    await h.n.confirmEmail(token);
    await expect(h.n.confirmEmail(token)).rejects.toThrow(/unknown or used/);
    await h.n.tick();
    expect(h.mails[1].subject).toContain("above your cap");
    expect(h.mails[1].text).toContain("https://app.example/claim/1");
    expect((await h.n.settings(h.req({ action: "get" }))).email?.verified).toBe(true);
  });

  it("rejects malformed input", async () => {
    const h = harness();
    await expect(h.n.settings(h.req({ action: "set_email", email: "nope" }))).rejects.toThrow(/valid email/);
    await expect(h.n.settings(h.req({ action: "subscribe_push", subscription: { endpoint: "http://x", keys: { p256dh: "", auth: "" } } }))).rejects.toThrow(/invalid push/);
  });
});

describe("watched prices", () => {
  const cov = { flight: { ...flight, flight_number: "VY8306", airline: "VY", departure_date: "2030-04-14" } };
  it("needs a verified price, alerts once per band, and can be removed", async () => {
    const h = harness({ watchRefreshSecs: 0 });
    await h.n.settings(h.req({ action: "subscribe_push", subscription: SUB }));
    h.chain.price = 17_000; // the harness answers every snapshot with this price
    const v = await h.n.settings(h.req({ action: "watch_add", coverage: cov, seats: 2 }));
    expect(v.watches).toHaveLength(1);
    expect(v.watches[0]).toMatchObject({ label: "VY8306 AMS→BCN, 2030-04-14", seats: 2, baseline_minor: 17_000, price_minor: 17_000 });
    expect(v.watches[0].href).toContain("fn=VY8306");
    // Same price: nothing to say. (Cap #1 is under its cap at €170 too.)
    expect(await h.n.tick()).toBe(0);
    h.chain.price = 19_000;
    expect(await h.n.tick()).toBe(2); // the cap alert for policy #1 and the watch
    expect(h.pushes.map((p) => p.title)).toContain("VY8306 AMS→BCN, 2030-04-14: up €20 to €190");
    // One-tap lock is off by default: alerts are exactly as before.
    expect(h.pushes.every((p) => p.quick_url === undefined)).toBe(true);
    expect(await h.n.tick()).toBe(0);
    const after = await h.n.settings(h.req({ action: "watch_remove", id: v.watches[0].id }));
    expect(after.watches).toEqual([]);
  });

  it("one-tap lock is an option: when on, rise alerts carry a second action", async () => {
    const h = harness({ watchRefreshSecs: 0 });
    await h.n.settings(h.req({ action: "subscribe_push", subscription: SUB }));
    expect((await h.n.settings(h.req({ action: "get" }))).quick_lock).toBe(false);
    expect((await h.n.settings(h.req({ action: "set_quick_lock", on: true }))).quick_lock).toBe(true);
    await h.n.settings(h.req({ action: "watch_add", coverage: cov }));
    h.chain.price = 19_000;
    await h.n.tick();
    const p = h.pushes.find((x) => x.title.startsWith("VY8306"))!;
    expect(p.quick_action).toBe("Lock at €205");
    expect(p.quick_url).toBe("https://app.example/quote?fn=VY8306&date=2030-04-14&from=AMS&to=BCN&fare=economy_light&product=cap&quick=1&cap=20500");
    // The cap alert of policy #1 has no quick action (nothing to lock).
    expect(h.pushes.find((x) => x.title.includes("above your cap"))!.quick_url).toBeUndefined();
  });

  it("rejects what it cannot watch", async () => {
    const h = harness();
    await expect(h.n.settings(h.req({ action: "watch_add", coverage: { flight: { ...flight, origin: "AM" } } }))).rejects.toThrow(/IATA/);
    await expect(h.n.settings(h.req({ action: "watch_add", coverage: { flight: { ...flight, departure_date: "2020-01-01" } } }))).rejects.toThrow(/already left/);
    const unpriced = harness({ prices: async () => null });
    unpriced.chain.price = null;
    await expect(unpriced.n.settings(unpriced.req({ action: "watch_add", coverage: cov }))).rejects.toThrow(/verified price/);
  });

  it("uses the oracle price when there is one, and forgets watches once the day has passed", async () => {
    let oracle = 15_000;
    let now = T;
    const h = harness({ now: () => now, prices: async () => ({ price_minor: oracle, available: true }), watchRefreshSecs: 0 });
    const v = await h.n.settings(h.req({ action: "watch_add", coverage: cov, target_minor: 14_000 }));
    expect(v.watches[0]).toMatchObject({ baseline_minor: 15_000, target_minor: 14_000 });
    oracle = 13_900;
    expect((await h.n.settings(h.req({ action: "get" }))).watches[0].price_minor).toBe(13_900);
    now = Date.parse("2030-04-15T12:00:00Z") / 1000;
    expect((await h.n.settings(h.req({ action: "get" }, "alice.test", now))).watches).toEqual([]);
  });
});

describe("alert email", () => {
  it("adds the one-tap link only when the account turned it on", async () => {
    const { alertMail } = await import("../src/channels.ts");
    const al = { id: "w:x:watch_rise:1", policy_id: 0, kind: "watch_rise" as const, urgency: "action" as const, title: "t", body: "b", action: "Lock a max price", href: "/quote?fn=KL1695", quick: { href: "/quote?fn=KL1695&quick=1&cap=20500", action: "Lock at €205" } };
    expect(alertMail(al, "https://app.example").text).not.toContain("quick=1");
    const on = alertMail(al, "https://app.example", true).text;
    expect(on).toContain("Lock a max price: https://app.example/quote?fn=KL1695\n");
    expect(on).toContain("Lock at €205 (one tap, you confirm on the page): https://app.example/quote?fn=KL1695&quick=1&cap=20500");
  });
});

describe("demo outbox", () => {
  it("shows each account only its own mail, even for a shared address", async () => {
    const { realChannels } = await import("../src/channels.ts");
    process.env.VAPID_PUBLIC_KEY = "BKx3v3wbN1HcRYBgYdS0uQ3rH4Jj1yVq1cC8b5r7m3vQdC1yQf0n3m0xQ4zVd2bY7Zl5Z8y9u0w1x2y3z4a5b6c";
    process.env.VAPID_PRIVATE_KEY = "dGVzdC1wcml2YXRlLWtleS0wMDAwMDAwMDAwMDAwMDA";
    const store = new Store();
    const ch = realChannels(store, { demo: true, subject: "mailto:t@example.org" });
    await ch.mail("same@example.org", "for alice", "x", "alice.test");
    await ch.mail("same@example.org", "for bob", "y", "bob.test");
    const n = new Notifier({ store, channels: ch, rpc: {} as never, registryId: "r", attestationId: "a", appUrl: "https://app.example" });
    expect(n.outbox("alice.test").map((m) => m.subject)).toEqual(["for alice"]);
    expect(n.outbox("bob.test").map((m) => m.subject)).toEqual(["for bob"]);
  });
});
