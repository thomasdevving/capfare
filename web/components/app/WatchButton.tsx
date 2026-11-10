"use client";
/**
 * "Watch the price (free)": no policy, nothing on-chain. The alert service checks the verified
 * price and tells you when it moves 10% (at least €10) or reaches your target. Signed with your
 * account key like the other alert settings; which flights you watch stays with the alert service.
 */
import { useEffect, useRef, useState } from "react";
import { type Coverage } from "@capfare/shared";
import { signAccountRequest } from "@/lib/wallet";
import { eur } from "@/lib/format";
import { errText, getJson, Msg, postJson, useSession } from "./ui";

interface View {
  push_devices: number;
  email: { verified: boolean } | null;
  watches: { id: string }[];
}

export default function WatchButton({ coverages, seats, prices, highlight = false }: { coverages: Coverage[]; seats: number; prices: number[]; highlight?: boolean }) {
  const s = useSession();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string; channels?: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getJson("/api/notify/config").then(() => setAvailable(true)).catch(() => setAvailable(false));
  }, []);
  useEffect(() => {
    if (highlight && available) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, available]);
  useEffect(() => setMsg(null), [coverages]);

  if (!available) return null; // no alert service on this deployment

  async function watch() {
    setBusy(true);
    setMsg(null);
    try {
      const t = target.trim() ? Math.round(Number(target.replace(",", ".")) * 100) : undefined;
      if (t !== undefined && !(t > 0)) throw new Error("Enter a target price in euros, or leave it empty.");
      let v: View | null = null;
      for (const coverage of coverages) {
        const payload = { action: "watch_add", coverage, seats, ...(t !== undefined && coverages.length === 1 ? { target_minor: t } : {}) };
        v = await postJson<View>("/api/notify/settings", await signAccountRequest("notify", payload));
      }
      const channels = !!v && (v.push_devices > 0 || !!v.email?.verified);
      setMsg({
        kind: "ok",
        text: `Watching ${coverages.length > 1 ? "both flights" : "this price"}. We'll tell you when it moves 10% or more${t !== undefined ? ` or reaches ${eur(t)}` : ""}.`,
        channels,
      });
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className={`watch-box${highlight ? " is-highlighted" : ""}`}>
      <h3 style={{ fontSize: "var(--s3)", margin: "0 0 4px" }}>Not ready to lock it? Watch the price for free</h3>
      <p className="small muted" style={{ margin: "0 0 10px" }}>
        We check the verified price {prices.length > 1 ? "of both flights " : ""}and alert you when it moves 10% or more from {prices.map((p) => eur(p)).join(" / ")}. No policy, no cost.{s === null ? " You need a free account (below)." : ""}
      </p>
      {s ? (
        <form
          className="btn-row"
          style={{ alignItems: "flex-end" }}
          onSubmit={(e) => {
            e.preventDefault();
            void watch();
          }}
        >
          {coverages.length === 1 ? (
            <div style={{ flex: "0 1 220px" }}>
              <label htmlFor="watch-target">Also tell me at or below (€, optional)</label>
              <input id="watch-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={String(Math.floor((prices[0] * 0.9) / 100))} />
            </div>
          ) : null}
          <button className="btn" disabled={busy}>{busy ? "Starting…" : "Watch the price"}</button>
        </form>
      ) : null}
      {msg ? (
        <Msg kind={msg.kind}>
          {msg.text}
          {msg.kind === "ok" ? (
            msg.channels ? (
              <> See all watched prices on <a href="/policies#watching">your policies page</a>.</>
            ) : (
              <> Turn on push or email alerts on <a href="/policies#watching">your policies page</a> to hear about it.</>
            )
          ) : null}
        </Msg>
      ) : null}
    </div>
  );
}
