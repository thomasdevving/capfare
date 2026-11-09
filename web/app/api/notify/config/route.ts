import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET() {
  return forward(serverConfig().notifierUrl, "/v1/config", undefined, "GET");
}
