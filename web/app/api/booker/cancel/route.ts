import { NextResponse, type NextRequest } from "next/server";
import { cancelBooking } from "@/lib/booker/store";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { ref: string; token: string };
  try {
    const bk = await cancelBooking(b.ref, b.token);
    return NextResponse.json({ status: bk.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
