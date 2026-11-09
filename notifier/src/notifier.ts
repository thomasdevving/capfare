/**
 * Delivers alerts (shared/src/alerts.ts) to subscribed accounts. Each tick reads public chain
 * state per account, computes the alerts, and sends each new alert id once per account.
 */
import { randomBytes } from "node:crypto";
import { accountAlerts, type Alert, type GlobalParams, type NearViewClient, type Params, type Policy, type SnapshotRecord, type SignedAccountRequest, verifyAccountRequest } from "@capfare/shared";
import { alertMail, type Channels } from "./channels.ts";
import { maskEmail, MAX_PUSH, type PushSub, type Store } from "./store.ts";

export const SCOPE = "notify";
const MAX_PER_TICK = 5;

export interface NotifierOptions {
  store: Store;
  channels: Channels;
  rpc: Pick<NearViewClient, "view" | "blockTimeSecs" | "hasAccessKey">;
  registryId: string;
  attestationId: string;
  /** Public web app URL, for links in alerts and email confirmations. */
  appUrl: string;
  log?: (m: string, d?: Record<string, unknown>) => void;
  now?: () => number;
}

export type SettingsAction =
  | { action: "get" }
  | { action: "subscribe_push"; subscription: PushSub }
  | { action: "unsubscribe_push"; endpoint: string }
  | { action: "set_email"; email: string }
  | { action: "remove_email" }
  | { action: "test" };

export interface SettingsView {
  push_devices: number;
  email: { address: string; verified: boolean } | null;
  email_mode: Channels["emailMode"];
}

export class NotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export class Notifier {
  private now: () => number;
  constructor(private o: NotifierOptions) {
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private async state(account: string): Promise<{ alerts: Alert[] }> {
    const [policies, params, now] = await Promise.all([
      this.o.rpc.view<Policy[]>(this.o.registryId, "get_policies_by_owner", { account_id: account, from_index: 0, limit: 100 }),
      this.o.rpc.view<Params>(this.o.registryId, "get_params"),
      this.o.rpc.blockTimeSecs(),
    ]);
    const live = policies.filter((p) => ["active", "claimed", "paid_out"].includes(p.state));
    const snaps: Record<string, SnapshotRecord | null> = {};
    for (const h of new Set(live.map((p) => p.flight_key_hash))) {
      snaps[h] = await this.o.rpc.view<SnapshotRecord | null>(this.o.attestationId, "get_latest_snapshot", { flight_key_hash: h });
    }
    return { alerts: accountAlerts(live, snaps, now, params.global as GlobalParams) };
  }

  private view(account: string): SettingsView {
    const a = this.o.store.account(account);
    return {
      push_devices: a.push.length,
      email: a.email ? { address: maskEmail(a.email.address), verified: a.email.verified } : null,
      email_mode: this.o.channels.emailMode,
    };
  }

  /** Authenticated settings change: signature by an access key of the account. */
  async settings(req: SignedAccountRequest<SettingsAction>): Promise<SettingsView> {
    const bad = verifyAccountRequest(SCOPE, req, this.now());
    if (bad) throw new NotifyError(401, bad);
    if (!(await this.o.rpc.hasAccessKey(req.account_id, req.public_key))) throw new NotifyError(401, "that key does not belong to this account");
    const id = req.account_id;
    const a = this.o.store.account(id);
    const p = req.payload;
    switch (p?.action) {
      case "get":
        break;
      case "subscribe_push": {
        const s = p.subscription;
        if (!s?.endpoint?.startsWith("https://") || !s.keys?.p256dh || !s.keys?.auth) throw new NotifyError(400, "invalid push subscription");
        a.push = [...a.push.filter((x) => x.endpoint !== s.endpoint), { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }].slice(-MAX_PUSH);
        await this.seed(id);
        break;
      }
      case "unsubscribe_push":
        a.push = a.push.filter((x) => x.endpoint !== p.endpoint);
        break;
      case "set_email": {
        const email = String(p.email ?? "").trim();
        if (!EMAIL_RE.test(email)) throw new NotifyError(400, "enter a valid email address");
        if (this.o.channels.emailMode === "off") throw new NotifyError(400, "email alerts are not available on this deployment");
        const token = randomBytes(18).toString("base64url");
        a.email = { address: email, verified: false, token, token_expires: this.now() + 86_400 };
        // Double opt-in: nothing else is sent until the owner of the address confirms.
        await this.o.channels.mail(
          email,
          "Confirm your CapFare alerts",
          [`Someone (hopefully you) asked to get CapFare alerts for ${id} at this address.`, "", `Confirm: ${this.o.appUrl}/notify/confirm?token=${token}`, "", "Ignore this email if it wasn't you; nothing else will be sent."].join("\n"),
        );
        break;
      }
      case "remove_email":
        delete a.email;
        break;
      case "test":
        await this.deliver(id, [
          { id: `test:${this.now()}`, policy_id: 0, kind: "paid_out", urgency: "info", title: "CapFare alerts are on", body: "This is a test. You'll hear from us when a price moves past your cap or something needs doing.", href: "/policies", action: "Open CapFare" },
        ]);
        break;
      default:
        throw new NotifyError(400, "unknown action");
    }
    this.o.store.save();
    return this.view(id);
  }

  /** Double opt-in link from the confirmation email. */
  async confirmEmail(token: string): Promise<{ ok: true }> {
    for (const [id, a] of Object.entries(this.o.store.state.accounts)) {
      if (a.email?.token && a.email.token === token) {
        if ((a.email.token_expires ?? 0) < this.now()) throw new NotifyError(410, "this link has expired; add your email again");
        a.email = { address: a.email.address, verified: true };
        await this.seed(id);
        this.o.store.save();
        return { ok: true };
      }
    }
    throw new NotifyError(404, "unknown or used link");
  }

  /**
   * On a new channel: alerts that are only informational (old payouts, "your cap is active")
   * are marked as already sent so nobody gets a burst of history. Things to do now still go out.
   */
  private async seed(account: string) {
    try {
      const { alerts } = await this.state(account);
      this.o.store.markSent(account, alerts.filter((x) => x.urgency === "info").map((x) => x.id));
    } catch {
      /* chain unreachable: nothing to seed */
    }
  }

  private async deliver(account: string, alerts: Alert[]): Promise<number> {
    const a = this.o.store.account(account);
    let n = 0;
    for (const al of alerts) {
      const msg = { title: al.title, body: al.body, url: `${this.o.appUrl}${al.href}`, tag: al.id };
      const results = await Promise.all(a.push.map(async (s) => [s, await this.o.channels.push(s, msg)] as const));
      const gone = new Set(results.filter(([, r]) => r === "gone").map(([s]) => s.endpoint));
      if (gone.size) a.push = a.push.filter((s) => !gone.has(s.endpoint));
      if (a.email?.verified) {
        const m = alertMail(al, this.o.appUrl);
        await this.o.channels.mail(a.email.address, m.subject, m.text).catch((e) => this.o.log?.("mail_failed", { error: String(e) }));
      }
      n++;
    }
    return n;
  }

  /** One pass over all subscribed accounts. Returns the number of alerts delivered. */
  async tick(): Promise<number> {
    let total = 0;
    for (const account of this.o.store.subscribed()) {
      try {
        const { alerts } = await this.state(account);
        const a = this.o.store.account(account);
        const fresh = alerts.filter((x) => !a.sent.includes(x.id)).slice(0, MAX_PER_TICK);
        if (!fresh.length) continue;
        total += await this.deliver(account, fresh);
        this.o.store.markSent(account, fresh.map((x) => x.id));
      } catch (e) {
        this.o.log?.("tick_failed", { account, error: String(e) });
      }
    }
    this.o.store.save();
    return total;
  }

  /** Demo only: mail "sent" to this account's address. */
  outbox(account: string) {
    const addr = this.o.store.account(account).email?.address;
    return addr ? this.o.store.state.outbox.filter((m) => m.to === addr) : [];
  }
}
