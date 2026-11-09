import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  return forward(serverConfig().relayerUrl, "/v1/relay", await req.json());
}
