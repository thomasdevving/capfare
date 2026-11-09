/**
 * Original-email checks: DKIM (with ARC as a fallback for mail that passed through an
 * intermediary that re-sealed it), alignment with the From domain, airline domain
 * allowlist, and rejection of forwarded or modified mails.
 */
import { authenticate, dkimVerify } from "mailauth";

export type Resolver = (name: string, rr: string) => Promise<unknown>;

export interface DkimOk {
  ok: true;
  domain: string;
  via: "dkim" | "arc";
  date: Date;
  subject: string;
}
export interface DkimFail {
  ok: false;
  reason: string;
}

function header(raw: string, name: string): string[] {
  const head = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, " ");
  return head
    .split(/\r?\n/)
    .filter((l) => l.toLowerCase().startsWith(name.toLowerCase() + ":"))
    .map((l) => l.slice(name.length + 1).trim());
}

function domainOf(addr: string): string {
  const m = /@([A-Za-z0-9.-]+)>?\s*$/.exec(addr) ?? /@([A-Za-z0-9.-]+)/.exec(addr);
  return (m?.[1] ?? "").toLowerCase();
}

function allowed(domain: string, allow: string[]): boolean {
  return allow.some((d) => domain === d || domain.endsWith("." + d));
}

export async function verifyOriginalEml(rawInput: string | Buffer, allow: string[], opts: { resolver?: Resolver; now?: Date } = {}): Promise<DkimOk | DkimFail> {
  const raw = typeof rawInput === "string" ? rawInput : rawInput.toString("utf8");
  const froms = header(raw, "From");
  if (froms.length !== 1) return { ok: false, reason: "message must have exactly one From header" };
  const fromDomain = domainOf(froms[0]);
  const subject = header(raw, "Subject")[0] ?? "";
  if (/^\s*(fwd?|fw|wg|tr|doorst(uren)?)\s*:/i.test(subject)) return { ok: false, reason: "forwarded email: upload the original confirmation, not a forward" };
  if (header(raw, "Resent-From").length || header(raw, "X-Forwarded-For").length || header(raw, "X-Forwarded-To").length) {
    return { ok: false, reason: "forwarded email: upload the original confirmation, not a forward" };
  }
  if (!allowed(fromDomain, allow)) return { ok: false, reason: `sender domain ${fromDomain || "?"} is not a supported airline` };
  const dateHdr = header(raw, "Date")[0];
  const date = dateHdr ? new Date(dateHdr) : null;
  if (!date || Number.isNaN(date.getTime())) return { ok: false, reason: "missing or invalid Date header" };
  // Partial-body signatures (l=) would allow appended content: reject.
  for (const sig of header(raw, "DKIM-Signature")) {
    if (/(^|;)\s*l\s*=/.test(sig)) return { ok: false, reason: "partial-body DKIM signatures are not accepted" };
  }
  const v = await dkimVerify(raw, { resolver: opts.resolver as never, curTime: opts.now });
  const good = (v.results ?? []).find((r: any) => {
    const signed = String(r.signingHeaders?.keys ?? "").toLowerCase();
    return (
      r.status?.result === "pass" &&
      allowed(String(r.signingDomain).toLowerCase(), allow) &&
      r.status?.aligned &&
      signed.includes("from") &&
      signed.includes("date")
    );
  });
  if (good) return { ok: true, domain: String(good.signingDomain).toLowerCase(), via: "dkim", date, subject };
  // ARC fallback: a valid ARC chain whose first hop saw dkim=pass for an airline domain.
  try {
    const a: any = await authenticate(raw, { resolver: opts.resolver as never, trustReceived: false, ip: "127.0.0.1", helo: "localhost", sender: froms[0] } as never);
    if (a?.arc?.status?.result === "pass") {
      const aar = header(raw, "ARC-Authentication-Results").find((h) => /\bi\s*=\s*1\s*;/.test(h)) ?? "";
      const m = /dkim=pass[^;]*header\.(?:d|i)=@?([A-Za-z0-9.-]+)/i.exec(aar);
      if (m && allowed(m[1].toLowerCase(), allow) && allowed(fromDomain, [m[1].toLowerCase()])) {
        return { ok: true, domain: m[1].toLowerCase(), via: "arc", date, subject };
      }
    }
  } catch {
    /* fall through */
  }
  const real = (v.results ?? []).filter((r: any) => r.status?.result !== "none");
  if (!real.length) return { ok: false, reason: "email is not DKIM-signed" };
  const reasons = real.map((r: any) => `${r.signingDomain}: ${r.status?.result}${r.status?.comment ? ` (${r.status.comment})` : ""}`);
  return { ok: false, reason: reasons.length ? `DKIM check failed: ${reasons.join("; ")}` : "email is not DKIM-signed" };
}
