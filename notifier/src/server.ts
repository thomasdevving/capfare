/**
 * notifier service: web push and email alerts for CapFare policies and watched prices.
 *   GET  /health
 *   GET  /v1/config                       {vapid_public_key, email_mode}
 *   POST /v1/settings                     signed {account_id, public_key, ts, payload: SettingsAction, signature}
 *                                         (includes watch_add / watch_remove: free price alerts, no policy)
 *   GET  /v1/confirm?token=               email double opt-in
 *   GET  /v1/demo/outbox?account=         (demo only) mail kept instead of sent
 * Reads only public chain state. Stores push endpoints and, if given, an email address.
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NearViewClient, type Coverage, type SignedAccountRequest, type SignedSnapshot } from "@capfare/shared";
import { HttpError, logger, RateLimiter, serve } from "@capfare/tee-common";
import { realChannels } from "./channels.ts";
import { Notifier, NotifyError, type SettingsAction } from "./notifier.ts";
import { Store } from "./store.ts";

const log = logger("notifier");

export async function main() {
  const mode = process.env.CAPFARE_DEPLOYMENT ?? "dev";
  const demo = mode === "demo" || mode === "test";
  const store = new Store(process.env.NOTIFIER_DATA_FILE ?? join(tmpdir(), "capfare-notifier.json"));
  const appUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // Push services require an https: or mailto: contact.
  const subject = process.env.VAPID_SUBJECT ?? (appUrl.startsWith("https://") ? appUrl : "mailto:alerts@capfare.invalid");
  const channels = realChannels(store, { demo, subject, smtpUrl: process.env.SMTP_URL, mailFrom: process.env.MAIL_FROM });
  const rpc = new NearViewClient({ rpcUrl: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });
  // Watched prices: a fresh signed price from the oracle (not submitted on-chain), else the chain.
  const oracleUrl = process.env.ORACLE_URL?.replace(/\/$/, "");
  const prices = oracleUrl
    ? async (c: Coverage) => {
        const body = "route" in c ? { route: c.route, submit: false } : { flight_key: c.flight, submit: false };
        const r = await fetch(`${oracleUrl}/v1/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) return null;
        const s = ((await r.json()) as { snapshot: SignedSnapshot }).snapshot.snapshot;
        return { price_minor: s.price_minor, available: s.available };
      }
    : undefined;
  const n = new Notifier({
    store, channels, rpc, registryId: process.env.REGISTRY_ID ?? "", attestationId: process.env.ATTESTATION_ID ?? "", appUrl, log, prices,
    watchRefreshSecs: Number(process.env.WATCH_REFRESH_SECS ?? (demo ? 0 : 3600)),
  });
  const limiter = new RateLimiter(20, 0.5);
  const wrap = async <T>(req: { socket: { remoteAddress?: string } }, f: () => Promise<T>) => {
    if (!limiter.take(req.socket.remoteAddress ?? "?")) throw new HttpError(429, "too many requests");
    try {
      return await f();
    } catch (e) {
      if (e instanceof NotifyError) throw new HttpError(e.status, e.message);
      throw e;
    }
  };
  const query = (url: string | undefined, k: string) => new URL(url ?? "/", "http://x").searchParams.get(k) ?? "";

  serve({
    port: Number(process.env.PORT ?? 8084),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
    log,
    routes: {
      "GET /health": () => ({ ok: true, mode, email_mode: channels.emailMode, subscribed: store.subscribed().length }),
      "GET /v1/config": () => ({ vapid_public_key: channels.vapidPublicKey, email_mode: channels.emailMode }),
      "POST /v1/settings": (body: SignedAccountRequest<SettingsAction>, req) => wrap(req, () => n.settings(body)),
      "GET /v1/confirm": (_b, req) => wrap(req, () => n.confirmEmail(query(req.url, "token"))),
      "GET /v1/demo/outbox": (_b, req) => {
        if (!demo) throw new HttpError(404, "not a demo deployment");
        return n.outbox(query(req.url, "account"));
      },
    },
  });

  const every = Number(process.env.NOTIFY_TICK_SECS ?? (demo ? 15 : 60)) * 1000;
  if (process.env.REGISTRY_ID) {
    setInterval(() => {
      n.tick().then((k) => k && log("delivered", { alerts: k })).catch((e) => log("tick_failed", { error: String(e) }));
    }, every);
  }
  log("started", { mode, email_mode: channels.emailMode, tick_ms: every });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
