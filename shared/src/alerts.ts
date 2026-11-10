/**
 * Alerts: what a policy holder should know or do right now, derived only from public chain
 * state (policy, latest oracle snapshot, block time, global parameters). The web app shows them
 * in-app; the notifier service delivers new ones by web push and email. Pure and deterministic,
 * so both always agree. Alert ids are stable: a channel sends each id at most once.
 */
import { coverageLabel, coverageRoute } from "./encoding.ts";
import type { Coverage, Policy, SnapshotRecord } from "./types.ts";

export type AlertKind =
  | "cap_active"
  | "cap_in_money"
  | "cap_expiring"
  | "claim_window"
  | "sold_out"
  | "drop_falling"
  | "drop_settle"
  | "payout_held"
  | "final_check_soon"
  | "final_check_due"
  | "final_check_missed"
  | "payout_failed"
  | "paid_out"
  | "watch_rise"
  | "watch_drop"
  | "watch_target"
  | "watch_sold_out";

/** urgent: money is lost if ignored; action: worth doing now; info: good to know. */
export type Urgency = "urgent" | "action" | "info";

export interface Alert {
  id: string;
  /** 0 for alerts about a watched price (no policy). */
  policy_id: number;
  kind: AlertKind;
  urgency: Urgency;
  title: string;
  body: string;
  /** Path in the web app. */
  href: string;
  action: string;
}

export interface AlertContext {
  now: number;
  snapshot: SnapshotRecord | null | undefined;
  claim_grace_secs: number;
  sold_out_premium_refund: boolean;
}

const H = 3600;
const DAY = 24 * H;

export const eurText = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export function whenText(ts: number): string {
  const d = new Date(ts * 1000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function inText(secs: number): string {
  if (secs < 2 * H) return `${Math.max(1, Math.round(secs / 60))} minutes`;
  if (secs < 2 * DAY) return `${Math.round(secs / H)} hours`;
  return `${Math.round(secs / DAY)} days`;
}

const travellers = (n: number) => (n > 1 ? ` for ${n} travellers` : "");

/** Alerts for one policy, most urgent first. */
export function policyAlerts(p: Policy, ctx: AlertContext): Alert[] {
  const out: Alert[] = [];
  const { now, snapshot: s } = ctx;
  const label = coverageLabel(p.coverage);
  const seats = p.seats_covered ?? p.seats;
  const add = (kind: AlertKind, urgency: Urgency, title: string, body: string, action: string, href: string, suffix = "") =>
    out.push({ id: `${p.id}:${kind}${suffix}`, policy_id: p.id, kind, urgency, title, body, action, href });
  const claim = `/claim/${p.id}`;
  const card = `/policies#p${p.id}`;

  if (p.state === "active" && p.product === "cap") {
    if (now >= p.active_from && now <= p.expires_at) {
      const over = s && s.available ? s.price_minor - p.strike_minor : 0;
      const perSeat = Math.min(Math.max(0, over - p.deductible_minor), p.max_payout_minor);
      if (perSeat > 0) {
        // A new alert for every €20 more the traveller could get back.
        add(
          "cap_in_money",
          "action",
          `${label}: ${eurText(over)} above your cap`,
          `The cheapest ${"route" in p.coverage ? "fare on the route" : "fare"} is ${eurText(s!.price_minor)}. Book now, on any site, and claim up to ${eurText(perSeat * p.seats)}${travellers(p.seats)}.`,
          "I booked: claim",
          claim,
          `:${Math.floor(perSeat / 2000)}`,
        );
      } else if (now - p.active_from < DAY) {
        add("cap_active", "info", `Price Cap #${p.id} is active`, `${label}: we'll tell you if the price goes above your cap of ${eurText(p.strike_minor)}.`, "View", card);
      }
      if (p.expires_at - now <= DAY) {
        add("cap_expiring", "action", `Your Price Cap ends in ${inText(p.expires_at - now)}`, `${label}: bookings made after ${whenText(p.expires_at)} are not covered. Already booked? Claim now.`, "Claim", claim);
      }
      if (s && !s.available && ctx.sold_out_premium_refund) {
        add("sold_out", "action", "Fare sold out: get your premium back", `${label}: the covered fare class is sold out. Your premium of ${eurText(p.premium_minor)} can go back to your credit.`, "Refund premium", card);
      }
    } else if (now > p.expires_at && now <= p.expires_at + ctx.claim_grace_secs) {
      add("claim_window", "action", "Booked while your cap was active? Claim soon", `${label}: claims close ${whenText(p.expires_at + ctx.claim_grace_secs)}.`, "Claim", claim);
    }
  }

  if (p.state === "active" && p.product === "drop") {
    if (now < p.expires_at && s && s.available && s.price_minor < p.strike_minor) {
      const fall = p.strike_minor - s.price_minor;
      const perSeat = Math.min(Math.max(0, fall - p.deductible_minor), p.max_payout_minor);
      if (perSeat > 0) {
        add(
          "drop_falling",
          "info",
          `${label}: price fell ${eurText(fall)} below what you paid`,
          `You're covered for ${eurText(perSeat * seats)}${travellers(seats)} so far. Settle when the window ends (${whenText(p.expires_at)}).`,
          "View",
          card,
          `:${Math.floor(perSeat / 1000)}`,
        );
      }
    } else if (now >= p.expires_at && now <= p.expires_at + ctx.claim_grace_secs) {
      add("drop_settle", "action", "Collect your Drop Guarantee", `${label}: the window has ended. Confirm your booking is still active to settle, before ${whenText(p.expires_at + ctx.claim_grace_secs)}.`, "Settle", claim);
    }
  }

  if (p.state === "claimed" && p.final_check_at !== null) {
    const amount = eurText(p.payout_minor ?? 0);
    const deadline = p.departure_ts + ctx.claim_grace_secs;
    if (now > deadline) {
      add("final_check_missed", "info", "Final booking check missed", `${label}: the ${amount} payout was waiting for a check of your booking. The deadline has passed, so the claim can be closed without payout.`, "View", card);
    } else if (now >= p.final_check_at) {
      add("final_check_due", "urgent", `Confirm your booking to receive ${amount}`, `${label}: open your booking page and press Verify with CapFare (or paste the booking link). Deadline ${whenText(deadline)}.`, "Confirm booking", claim);
    } else if (p.final_check_at - now <= DAY) {
      add("final_check_soon", "info", `Final booking check opens in ${inText(p.final_check_at - now)}`, `${label}: your ${amount} payout is paid once you confirm the booking is still active, from ${whenText(p.final_check_at)}.`, "View", card);
    } else {
      add("payout_held", "info", `${amount} approved`, `${label}: refundable ticket, so it's paid after a final check of your booking from ${whenText(p.final_check_at)}. We'll remind you.`, "View", card);
    }
  }

  if (p.state === "claimed" && p.final_check_at === null && !p.busy) {
    add("payout_failed", "action", "Payout transfer failed", `${label}: the ${eurText(p.payout_minor ?? 0)} payout could not be sent. Retry from your policies page.`, "Retry payout", card);
  }

  if (p.state === "paid_out" && (p.payout_minor ?? 0) > 0) {
    add("paid_out", "info", `${eurText(p.payout_minor!)} paid to your account`, `${label}: ${p.product === "cap" ? "Price Cap" : "Drop Guarantee"} #${p.id}${travellers(seats)}.`, "View", card);
  }
  return out;
}

const RANK: Record<Urgency, number> = { urgent: 0, action: 1, info: 2 };

/** All alerts for an account's policies, most urgent first. */
export function accountAlerts(
  policies: Policy[],
  snapshots: Record<string, SnapshotRecord | null | undefined>,
  now: number,
  g: { claim_grace_secs: number; sold_out_premium_refund: boolean },
): Alert[] {
  return policies
    .flatMap((p) => policyAlerts(p, { now, snapshot: snapshots[p.flight_key_hash], claim_grace_secs: g.claim_grace_secs, sold_out_premium_refund: g.sold_out_premium_refund }))
    .sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || b.policy_id - a.policy_id);
}

/* ------------------------------------------------------------ watched prices */

/**
 * A free price watch: no policy, nothing on-chain. The notifier keeps it and checks the verified
 * price; the traveller hears when it moves. Turns "I'll check again tomorrow" into a reason to come
 * back, and tells them when a Price Cap is worth buying.
 */
export interface Watch {
  /** coverageHash(coverage): one watch per flight (or route and day) per account. */
  id: string;
  coverage: Coverage;
  seats: number;
  /** Verified price when the watch started (per person, cents). */
  baseline_minor: number;
  /** Optional: tell me when it is at or below this (per person, cents). */
  target_minor?: number;
  created_at: number;
}

export interface WatchPrice {
  price_minor: number;
  available: boolean;
}

/** Path in the web app to quote this coverage again. */
export function quoteHref(c: Coverage, seats = 1, product: "cap" | "drop" = "cap"): string {
  const r = coverageRoute(c);
  const q = new URLSearchParams({
    ...("flight" in c ? { fn: c.flight.flight_number } : { scope: "route" }),
    date: r.departure_date,
    from: r.origin,
    to: r.destination,
    fare: r.fare_class,
    product,
    ...(seats > 1 ? { pax: String(seats) } : {}),
  });
  return `/quote?${q}`;
}

/** Price moves are reported per band: 10% of the starting price, at least €10. */
export const watchBand = (baseline: number) => Math.max(1000, Math.round(baseline / 10));

/** Alerts for one watched price. Ids carry the band, so each further move alerts once. */
export function watchAlerts(w: Watch, p: WatchPrice | null | undefined): Alert[] {
  if (!p) return [];
  const label = coverageLabel(w.coverage);
  const href = quoteHref(w.coverage, w.seats);
  const out: Alert[] = [];
  const add = (kind: AlertKind, urgency: Urgency, suffix: string, title: string, body: string, action: string) =>
    out.push({ id: `w:${w.id}:${kind}${suffix}`, policy_id: 0, kind, urgency, title, body, action, href });
  if (!p.available) {
    add("watch_sold_out", "info", "", `${label}: sold out`, "The fare you're watching is sold out for now. We'll tell you if it comes back cheaper.", "View");
    return out;
  }
  const diff = p.price_minor - w.baseline_minor;
  const band = Math.trunc(diff / watchBand(w.baseline_minor));
  const pct = Math.round((Math.abs(diff) / w.baseline_minor) * 100);
  if (w.target_minor !== undefined && p.price_minor <= w.target_minor) {
    add("watch_target", "action", "", `${label}: ${eurText(p.price_minor)}, at or below your ${eurText(w.target_minor)}`, `The price you were waiting for${travellers(w.seats)}. Book it on any site, then add a Drop Guarantee in case it falls further.`, "See the price");
  } else if (band >= 1) {
    add("watch_rise", "action", `:${band}`, `${label}: up ${eurText(diff)} to ${eurText(p.price_minor)}`, `${pct}% more than when you started watching. A Price Cap locks a maximum price${travellers(w.seats)} before it climbs further.`, "Lock a max price");
  } else if (band <= -1) {
    add("watch_drop", "action", `:${-band}`, `${label}: down ${eurText(-diff)} to ${eurText(p.price_minor)}`, `${pct}% less than when you started watching. A good moment to book; a Drop Guarantee pays you back if it falls further within a week.`, "See the price");
  }
  return out;
}
