import { NextResponse, type NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
/** Demo only: alert emails are kept in an outbox instead of being sent. */
export async function GET(req: NextRequest) {
  const c = serverConfig();
  if (!c.demo) return NextResponse.json({ error: "not a demo deployment" }, { status: 404 });
  return forward(c.notifierUrl, `/v1/demo/outbox?account=${encodeURIComponent(req.nextUrl.searchParams.get("account") ?? "")}`, undefined, "GET");
}
