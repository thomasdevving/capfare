import { NextResponse, type NextRequest } from "next/server";
import { viewClient } from "@/lib/chain";
import { serverConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const c = serverConfig();
  const vault = req.nextUrl.searchParams.get("vault") === "drop" ? c.dropVault : c.capVault;
  const account = req.nextUrl.searchParams.get("account");
  try {
    const v = viewClient();
    const [history, queues, mine] = await Promise.all([
      v.view(vault, "get_history", { from: 0, limit: 104 }),
      v.view(vault, "get_queues"),
      account
        ? Promise.all([
            v.view<string>(vault, "get_shares", { account_id: account }),
            v.view<string>(vault, "get_share_value", { account_id: account }),
            v.view<string>(vault, "get_claimable", { account_id: account }),
            v.view<string>(c.token, "ft_balance_of", { account_id: account }).catch(() => "0"),
          ])
        : Promise.resolve(null),
    ]);
    return NextResponse.json({
      vault_id: vault,
      token: c.token,
      history,
      queues,
      mine: mine ? { shares: mine[0], value: mine[1], claimable: mine[2], wallet: mine[3] } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
