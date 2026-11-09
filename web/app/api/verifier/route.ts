import { serverConfig } from "@/lib/config";
import { forward } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET() {
  return forward(serverConfig().verifierUrl, "/v1/enclave", undefined, "GET");
}
