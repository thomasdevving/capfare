import { NextResponse } from "next/server";
import { overview } from "@/lib/chain";
import { networkLabel, serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const o = await overview();
    return NextResponse.json(
      { params: o.params, vault: o.vaults.cap, network: networkLabel(serverConfig().network), source: "contract" },
      { headers: { "cache-control": "public, max-age=30" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
