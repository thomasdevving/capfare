import { NextResponse, type NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["query", "block", "status", "gas_price", "EXPERIMENTAL_protocol_config", "network_info"]);

/** Read-only JSON-RPC proxy so browsers can fetch nonces/block hashes for signing. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !ALLOWED.has(body.method)) return NextResponse.json({ error: "method not allowed" }, { status: 403 });
  if (body.method === "query" && !["view_access_key", "view_account", "call_function", "view_access_key_list"].includes(body.params?.request_type)) {
    return NextResponse.json({ error: "query type not allowed" }, { status: 403 });
  }
  const r = await fetch(serverConfig().rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
