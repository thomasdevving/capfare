import { NextResponse, type NextRequest } from "next/server";
import { rampProvider } from "@/lib/ramp";
export const dynamic = "force-dynamic";
const seen = new Map<string, number>();
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { account_id: string; amount_eur_cents: number; method?: "ideal" | "card" };
  if (!b.account_id || !Number.isInteger(b.amount_eur_cents)) return NextResponse.json({ error: "account_id and amount required" }, { status: 400 });
  const n = (seen.get(b.account_id) ?? 0) + 1;
  seen.set(b.account_id, n);
  if (n > 20) return NextResponse.json({ error: "testnet top-up limit reached for this account" }, { status: 429 });
  try {
    return NextResponse.json(await rampProvider().createTopUp({ accountId: b.account_id, amountEurCents: b.amount_eur_cents, method: b.method ?? "ideal" }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}
