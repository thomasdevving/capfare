/** Delivery channels: web push (VAPID) and email (SMTP, or a demo outbox). */
import webpush from "web-push";
import nodemailer from "nodemailer";
import type { Alert } from "@capfare/shared";
import type { PushSub, Store } from "./store.ts";

export type PushResult = "ok" | "gone" | "error";

export interface Channels {
  push(sub: PushSub, a: { title: string; body: string; url: string; tag: string }): Promise<PushResult>;
  /** Returns false if email is not configured. */
  mail(to: string, subject: string, text: string): Promise<boolean>;
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
    async mail(to, subject, text) {
      if (transport) {
        await transport.sendMail({ from: opts.mailFrom ?? "CapFare <alerts@capfare.invalid>", to, subject, text });
        return true;
      }
      if (opts.demo) {
        store.state.outbox = [{ to, subject, text, at: Math.floor(Date.now() / 1000) }, ...store.state.outbox].slice(0, 100);
        store.save();
        return true;
      }
      return false;
    },
  };
}

export function alertMail(a: Alert, appUrl: string): { subject: string; text: string } {
  return {
    subject: `CapFare: ${a.title}`,
    text: [a.body, "", `${a.action}: ${appUrl}${a.href}`, "", "You get this because you turned on CapFare alerts. Turn them off on your policies page."].join("\n"),
  };
}
