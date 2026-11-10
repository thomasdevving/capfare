/** Delivery channels: web push (VAPID) and email (SMTP, or a demo outbox). */
import webpush from "web-push";
import nodemailer from "nodemailer";
import type { Alert } from "@capfare/shared";
import type { PushSub, Store } from "./store.ts";

export type PushResult = "ok" | "gone" | "error";

/** What the service worker (web/public/sw.js) shows. `quick_*`: optional second button. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  action?: string;
  quick_url?: string;
  quick_action?: string;
}

export interface Channels {
  push(sub: PushSub, a: PushMessage): Promise<PushResult>;
  /** Returns false if email is not configured. */
  mail(to: string, subject: string, text: string, account: string): Promise<boolean>;
  emailMode: "smtp" | "demo-outbox" | "off";
  vapidPublicKey: string;
}

export function vapidKeys(store: Store): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  if (!store.state.vapid) {
    store.state.vapid = webpush.generateVAPIDKeys();
    store.save();
  }
  return store.state.vapid;
}

export function realChannels(store: Store, opts: { demo: boolean; subject: string; smtpUrl?: string; mailFrom?: string }): Channels {
  const vapid = vapidKeys(store);
  webpush.setVapidDetails(opts.subject, vapid.publicKey, vapid.privateKey);
  const transport = opts.smtpUrl ? nodemailer.createTransport(opts.smtpUrl) : null;
  const emailMode = transport ? "smtp" : opts.demo ? "demo-outbox" : "off";
  return {
    vapidPublicKey: vapid.publicKey,
    emailMode,
    async push(sub, a) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(a), { TTL: 6 * 3600, urgency: "high" });
        return "ok";
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? "gone" : "error";
      }
    },
    async mail(to, subject, text, account) {
      if (transport) {
        await transport.sendMail({ from: opts.mailFrom ?? "CapFare <alerts@capfare.invalid>", to, subject, text });
        return true;
      }
      if (opts.demo) {
        store.state.outbox = [{ account, to, subject, text, at: Math.floor(Date.now() / 1000) }, ...store.state.outbox].slice(0, 100);
        store.save();
        return true;
      }
      return false;
    },
  };
}

/** `quick`: the account turned on one-tap lock, so the quick link is added after the normal one. */
export function alertMail(a: Alert, appUrl: string, quick = false): { subject: string; text: string } {
  const lines = [a.body, "", `${a.action}: ${appUrl}${a.href}`];
  if (quick && a.quick) lines.push(`${a.quick.action} (one tap, you confirm on the page): ${appUrl}${a.quick.href}`);
  return {
    subject: `CapFare: ${a.title}`,
    text: [...lines, "", "You get this because you turned on CapFare alerts. Turn them off on your policies page."].join("\n"),
  };
}
