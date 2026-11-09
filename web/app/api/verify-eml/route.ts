import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
/** The body is a box sealed in the browser to the enclave key: this server cannot read it. */
export async function POST(req: NextRequest) {
  const b = await req.json();
  return forward(serverConfig().verifierUrl, "/v1/verify/eml", { sealed: b.sealed });
}
