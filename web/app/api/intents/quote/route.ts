import { NextResponse, type NextRequest } from "next/server";
import { dryQuote, DESTINATIONS } from "@/lib/intents";
import { serverConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ destinations: DESTINATIONS });
}
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { amount_usdc_micro: string; destination: string };
  if (!/^\d{1,15}$/.test(String(b.amount_usdc_micro))) return NextResponse.json({ error: "amount required" }, { status: 400 });
  try {
    return NextResponse.json({ dry: true, quote: await dryQuote(b.amount_usdc_micro, b.destination, serverConfig().oneClickApiKey) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
