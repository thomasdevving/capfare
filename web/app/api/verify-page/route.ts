import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
/** Live check: the sealed booking-page link goes to the enclave, which loads the page itself. */
export async function POST(req: NextRequest) {
  const b = await req.json();
  return forward(serverConfig().verifierUrl, "/v1/verify/page", { sealed: b.sealed });
}
