import { NextResponse, type NextRequest } from "next/server";
import type { SnapshotRecord } from "@capfare/shared";
import { viewClient } from "@/lib/chain";
import { serverConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const h = req.nextUrl.searchParams.get("flight_key_hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(h)) return NextResponse.json({ error: "flight_key_hash required" }, { status: 400 });
  try {
    return NextResponse.json(await viewClient().view<SnapshotRecord[]>(serverConfig().attestation, "get_snapshots", { flight_key_hash: h, limit: 200 }));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
