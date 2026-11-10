/**
 * Notification subscriptions. This is the only CapFare component that stores personal data
 * (an email address, if the user adds one, and the prices someone watches): kept in one JSON
 * file next to the service, never logged, removed on request. Push subscriptions are opaque
 * browser endpoints.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Watch } from "@capfare/shared";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface EmailSub {
  address: string;
  verified: boolean;
  token?: string;
  token_expires?: number;
}

export interface AccountSubs {
  push: PushSub[];
  email?: EmailSub;
  /** Alert ids already delivered (bounded). */
  sent: string[];
  /** Watched prices (free alerts, no policy). Which flights someone watches is personal: kept here only. */
  watches?: WatchRecord[];
}

export interface WatchRecord extends Watch {
  last_price_minor?: number;
  last_available?: boolean;
  last_checked?: number;
}

export interface OutboxMail {
  /** The account the mail was sent for (demo outbox is shown per account). */
  account: string;
  to: string;
  subject: string;
  text: string;
  at: number;
}

export interface State {
  vapid?: { publicKey: string; privateKey: string };
  accounts: Record<string, AccountSubs>;
  /** Demo deployments only: mail is kept here instead of sent. */
  outbox: OutboxMail[];
}

export const MAX_SENT = 500;
export const MAX_PUSH = 5;
export const MAX_WATCHES = 20;

export class Store {
  state: State;
  constructor(private file?: string) {
    this.state = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as State) : { accounts: {}, outbox: [] };
    this.state.outbox ??= [];
  }

  account(id: string): AccountSubs {
    return (this.state.accounts[id] ??= { push: [], sent: [] });
  }

  /** Accounts with at least one delivery channel. */
  subscribed(): string[] {
    return Object.entries(this.state.accounts)
      .filter(([, a]) => a.push.length || a.email?.verified)
      .map(([id]) => id);
  }

  markSent(id: string, alertIds: string[]) {
    const a = this.account(id);
    a.sent = [...a.sent.filter((x) => !alertIds.includes(x)), ...alertIds].slice(-MAX_SENT);
  }

  save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/** "a…e@example.org": enough for the owner to recognise, not enough to leak in a screenshot. */
export function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  return `${u.slice(0, 1)}…${u.length > 1 ? u.slice(-1) : ""}@${d}`;
}
