import { NextResponse, type NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
/** Demo only: a synthetic, DKIM-signed confirmation email for testing claims. */
export async function POST(req: NextRequest) {
  const c = serverConfig();
  if (!c.demo) return NextResponse.json({ error: "not a demo deployment" }, { status: 404 });
  return forward(c.verifierUrl, "/v1/demo/fixture", await req.json());
}
