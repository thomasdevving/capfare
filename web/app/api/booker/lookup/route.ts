import { NextResponse, type NextRequest } from "next/server";
import { lookupBooking } from "@/lib/booker/store";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { ref: string; last: string };
  const bk = lookupBooking(b.ref ?? "", b.last ?? "");
  if (!bk) return NextResponse.json({ error: "We couldn't find a booking with that code and last name." }, { status: 404 });
  return NextResponse.json({ ref: bk.ref, token: bk.token });
}
