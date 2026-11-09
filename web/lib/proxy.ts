import { NextResponse } from "next/server";

/** Forwards JSON to an internal service and relays its status and body. */
export async function forward(url: string | undefined, path: string, body?: unknown, method = "POST") {
  if (!url) return NextResponse.json({ error: "service not configured on this deployment" }, { status: 503 });
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
    });
    const text = await r.text();
    return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "service unreachable; try again in a minute" }, { status: 502 });
  }
}
