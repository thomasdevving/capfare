import { NextResponse, type NextRequest } from "next/server";
import type { Params, Policy } from "@capfare/shared";
import { viewClient } from "@/lib/chain";
import { serverConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const c = serverConfig();
  const account = req.nextUrl.searchParams.get("account");
  const id = req.nextUrl.searchParams.get("id");
  try {
    const v = viewClient();
    if (id) return NextResponse.json(await v.view<Policy | null>(c.registry, "get_policy", { policy_id: Number(id) }));
    if (!account) return NextResponse.json({ error: "account required" }, { status: 400 });
    const [policies, credit, wallet, params] = await Promise.all([
      v.view<Policy[]>(c.registry, "get_policies_by_owner", { account_id: account, from_index: 0, limit: 100 }),
      v.view<string>(c.registry, "get_credit", { account_id: account }),
      v.view<string>(c.token, "ft_balance_of", { account_id: account }).catch(() => "0"),
      v.view<Params>(c.registry, "get_params"),
    ]);
    const snaps = await Promise.all(
      [...new Set(policies.map((p) => p.flight_key_hash))].map(async (h) => [h, await v.view(c.attestation, "get_latest_snapshot", { flight_key_hash: h })] as const),
    );
    return NextResponse.json({ policies, credit, wallet, snapshots: Object.fromEntries(snaps), now: await v.blockTimeSecs(), global: params.global });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
