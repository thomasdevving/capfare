import { NextResponse, type NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
/** Demo only: move the scripted price path and push a signed snapshot on-chain. */
export async function POST(req: NextRequest) {
  const c = serverConfig();
  if (!c.demo) return NextResponse.json({ error: "not a demo deployment" }, { status: 404 });
  const b = await req.json();
  const adv = await forward(c.oracleUrl, "/v1/demo/advance", b);
  if (adv.status !== 200) return adv;
  return forward(c.oracleUrl, "/v1/snapshot", { flight_key: b.flight_key, submit: true });
}
