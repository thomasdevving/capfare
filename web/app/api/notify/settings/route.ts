import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
/** Signed by the account's key in the browser; the notifier checks the signature and the key. */
export async function POST(req: NextRequest) {
  return forward(serverConfig().notifierUrl, "/v1/settings", await req.json());
}
