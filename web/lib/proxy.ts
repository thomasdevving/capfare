import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * The visitor's address, for the services' per-visitor limits. Behind a proxy (Railway) the
 * right-most X-Forwarded-For entry is the one the proxy added; entries to its left come from the
 * client and could be anything.
 */
export async function clientAddress(): Promise<string | undefined> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    return (xff ? xff.split(",").pop()!.trim() : h.get("x-real-ip") ?? undefined) || undefined;
  } catch {
    return undefined; // outside a request
  }
}

/** JSON headers for a call to an internal service, with the visitor's address for its limits. */
export async function serviceHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const ip = await clientAddress();
  if (ip) h["x-capfare-client"] = ip;
  return h;
}

/** Forwards JSON to an internal service and relays its status and body. */
export async function forward(url: string | undefined, path: string, body?: unknown, method = "POST") {
  if (!url) return NextResponse.json({ error: "service not configured on this deployment" }, { status: 503 });
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method,
      headers: await serviceHeaders(),
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
    });
    const text = await r.text();
    return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "service unreachable; try again in a minute" }, { status: 502 });
  }
}
