import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return forward(serverConfig().notifierUrl, `/v1/confirm?token=${encodeURIComponent(token)}`, undefined, "GET");
}
