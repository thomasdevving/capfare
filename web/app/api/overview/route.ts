import { NextResponse, type NextRequest } from "next/server";
import { overview } from "@/lib/chain";
import { networkLabel, serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const o = await overview();
    if (req.nextUrl.searchParams.get("lite")) {
      const sum = (k: "total_assets" | "locked_coverage" | "pending_withdrawals") => (BigInt(o.vaults.cap[k]) + BigInt(o.vaults.drop[k])).toString();
      return NextResponse.json({
        network: networkLabel(serverConfig().network),
        updatedAt: o.updatedAt,
        totalAssets: sum("total_assets"),
        locked: sum("locked_coverage"),
        pendingWithdrawals: sum("pending_withdrawals"),
        activePolicies: o.stats.active_cap + o.stats.active_drop,
        invariantOk: o.vaults.cap.invariant_ok && o.vaults.drop.invariant_ok,
      });
    }
    return NextResponse.json({ ...o, networkLabel: networkLabel(serverConfig().network) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
