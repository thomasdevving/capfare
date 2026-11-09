"use client";
import { useEffect, useState } from "react";
import { session, type Session } from "@/lib/wallet";

export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const f = () => setS(session());
    f();
    window.addEventListener("capfare-session", f);
    window.addEventListener("storage", f);
    return () => {
      window.removeEventListener("capfare-session", f);
      window.removeEventListener("storage", f);
    };
  }, []);
  return s;
}

export function Msg({ kind, children }: { kind: "ok" | "error" | "info"; children: React.ReactNode }) {
  return (
    <div className={`msg ${kind === "info" ? "" : kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `request failed (${r.status})`);
  return j;
}

export const postJson = <T,>(url: string, body: unknown) =>
  getJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SignInFirst() {
  return (
    <Msg kind="info">
      You need a CapFare account for this. <a href="/account">Create one with a passkey</a> — it takes a few seconds and costs nothing.
    </Msg>
  );
}
