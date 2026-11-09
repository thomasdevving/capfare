import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const b = await req.json();
  return forward(serverConfig().verifierUrl, "/v1/verify/status", { sealed: b.sealed });
}
