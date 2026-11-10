"use client";
/**
 * Alert channels: browser push (any device where you sign in) and email (double opt-in).
 * Settings are signed with your account key; the notifier checks the key on-chain.
 */
import { useCallback, useEffect, useState } from "react";
import { signAccountRequest } from "@/lib/wallet";
import { errText, getJson, Msg, postJson } from "./ui";

interface View {
  push_devices: number;
  email: { address: string; verified: boolean } | null;
  email_mode: "smtp" | "demo-outbox" | "off";
  quick_lock: boolean;
}

const b64ToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function send(payload: Record<string, unknown>): Promise<View> {
  return postJson<View>("/api/notify/settings", await signAccountRequest("notify", payload));
}

export default function NotifySettings({ accountId }: { accountId: string }) {
  const [cfg, setCfg] = useState<{ vapid_public_key: string; email_mode: View["email_mode"] } | null | undefined>(undefined);
  const [view, setView] = useState<View | null>(null);
  const [onThisDevice, setOnThisDevice] = useState(false);
  const [email, setEmail] = useState("");
  const [quickOn, setQuickOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [outbox, setOutbox] = useState<{ subject: string; text: string; at: number }[]>([]);
  const pushSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    getJson<{ vapid_public_key: string; email_mode: View["email_mode"] }>("/api/notify/config").then(setCfg).catch(() => setCfg(null));
  }, []);
  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.getRegistration("/sw.js").then(async (r) => setOnThisDevice(Boolean(await r?.pushManager.getSubscription())));
  }, [pushSupported]);
  const loadOutbox = useCallback(() => {
    if (cfg?.email_mode !== "demo-outbox") return;
    getJson<{ subject: string; text: string; at: number }[]>(`/api/notify/outbox?account=${encodeURIComponent(accountId)}`).then(setOutbox).catch(() => {});
  }, [cfg, accountId]);
  useEffect(() => {
    loadOutbox();
    const t = setInterval(loadOutbox, 15_000);
    return () => clearInterval(t);
  }, [loadOutbox]);

  if (cfg === undefined) return null;
  if (cfg === null) return null; // no notifier on this deployment: in-app alerts only

  async function run(label: string, f: () => Promise<View | void>, ok?: string) {
    setBusy(label);
    setMsg(null);
    try {
      const v = await f();
      if (v) setView(v);
      if (ok) setMsg({ kind: "ok", text: ok });
      loadOutbox();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const enablePush = () =>
    run("push", async () => {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked for this site in your browser settings.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapid_public_key) }));
      const v = await send({ action: "subscribe_push", subscription: sub.toJSON() });
      setOnThisDevice(true);
      return v;
    }, "Push alerts are on for this browser.");

  const disablePush = () =>
    run("push", async () => {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      const v = sub ? await send({ action: "unsubscribe_push", endpoint: sub.endpoint }) : undefined;
      await sub?.unsubscribe();
      setOnThisDevice(false);
      return v;
    }, "Push alerts are off for this browser.");

  return (
    <details className="card" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && !view && run("load", () => send({ action: "get" }))}>
      <summary><strong>Get alerts</strong> <span className="small muted">— when a price passes your cap or a watched price moves, a payout needs a booking check, or money arrives</span></summary>
      <div style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: "var(--s3)" }}>On this device</h3>
        {pushSupported ? (
          <div className="btn-row">
            {onThisDevice ? (
              <button className="btn" disabled={!!busy} onClick={disablePush}>Turn off push alerts here</button>
            ) : (
              <button className="btn btn-primary" disabled={!!busy} onClick={enablePush}>Turn on push alerts</button>
            )}
            {view && view.push_devices > 0 ? <span className="small muted" style={{ alignSelf: "center" }}>{view.push_devices} device{view.push_devices > 1 ? "s" : ""} subscribed</span> : null}
          </div>
        ) : (
          <p className="small muted">This browser does not support push notifications. On iPhone, add CapFare to your home screen first.</p>
        )}

        {cfg.email_mode !== "off" ? (
          <>
            <h3 style={{ fontSize: "var(--s3)", marginTop: 18 }}>By email</h3>
            {view?.email ? (
              <p className="small">
                {view.email.address} · {view.email.verified ? "confirmed" : "waiting for you to confirm (check your inbox)"}{" "}
                <button className="btn btn-sm" disabled={!!busy} onClick={() => run("email", () => send({ action: "remove_email" }), "Email alerts removed.")}>Remove</button>
              </p>
            ) : (
              <form
                className="btn-row"
                style={{ alignItems: "flex-end" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run("email", () => send({ action: "set_email", email }), "We sent a confirmation link. Alerts start once you confirm.");
                }}
              >
                <div style={{ flex: "1 1 240px" }}>
                  <label htmlFor="alert-email">Email address</label>
                  <input id="alert-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                </div>
                <button className="btn" disabled={!!busy}>Send confirmation</button>
              </form>
            )}
            <p className="hint">Your address is stored only by CapFare&apos;s alert service, never on the blockchain, and is deleted when you remove it.</p>
          </>
        ) : null}

        <h3 style={{ fontSize: "var(--s3)", marginTop: 18 }}>Price alerts</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={quickOn ?? view?.quick_lock ?? false}
            disabled={!!busy || !view}
            onChange={(e) => {
              const on = e.target.checked;
              setQuickOn(on);
              run("quick", async () => {
                try {
                  return await send({ action: "set_quick_lock", on });
                } finally {
                  setQuickOn(null); // the saved setting (or the old one, if saving failed)
                }
              }, on ? "One-tap lock is on for price alerts." : "One-tap lock is off. Price alerts link to the quote as before.");
            }}
          />
          <span>
            <strong>One-tap lock in price alerts</strong> (optional). When a price you watch rises or reaches your target, the alert also gets a{" "}
            <em>Lock at €…</em> button that opens the quote ready to confirm, with the maximum price set 6% above the price then. You still check it and press Lock yourself. The normal link stays.
          </span>
        </label>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn btn-sm" disabled={!!busy || !view || (view.push_devices === 0 && !view.email?.verified)} onClick={() => run("test", () => send({ action: "test" }), "Test alert sent.")}>Send a test alert</button>
        </div>
        {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}

        {cfg.email_mode === "demo-outbox" && outbox.length ? (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: "var(--s3)" }}>Demo outbox</h3>
            <p className="small muted">Demo deployment: alert emails are kept here instead of being sent.</p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {outbox.slice(0, 8).map((m) => (
                <li key={m.at + m.subject}>
                  <strong>{m.subject}</strong>
                  <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 10px", font: "inherit", color: "var(--muted)" }}>{m.text.replace(/https?:\/\/[^/\s]+/g, "")}</pre>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
