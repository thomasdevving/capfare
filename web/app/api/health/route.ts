import { NextResponse } from "next/server";
import { configured, serverConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
export function GET() {
  const c = serverConfig();
  return NextResponse.json({ ok: true, network: c.network, configured: configured(c), demo: c.demo });
}
