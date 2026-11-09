import { NextResponse, type NextRequest } from "next/server";
import { rampProvider } from "@/lib/ramp";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { account_id: string; amount_usdc_micro: string; iban: string };
  // Only a masked IBAN is passed on; nothing is stored or logged.
  const iban = String(b.iban ?? "").replace(/\s/g, "").toUpperCase();
  const masked = iban.length > 8 ? iban.slice(0, 4) + "*".repeat(iban.length - 8) + iban.slice(-4) : iban;
  try {
    return NextResponse.json(await rampProvider().createPayout({ accountId: b.account_id, amountUsdcMicro: b.amount_usdc_micro, ibanMasked: masked }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}
