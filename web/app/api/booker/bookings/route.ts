import { NextResponse, type NextRequest } from "next/server";
import { createBooking, manageUrl, type Passenger } from "@/lib/booker/store";
import type { FareId } from "@capfare/shared";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = (await req.json()) as { fn: string; from: string; to: string; date: string; fare: FareId; passengers: Passenger[]; email: string; card: string };
  try {
    const booking = await createBooking({ fn: b.fn, origin: b.from, destination: b.to, date: b.date, fare: b.fare, passengers: b.passengers, email: b.email, card: b.card });
    return NextResponse.json({ ref: booking.ref, token: booking.token, manage: manageUrl(booking, req.nextUrl.origin) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}
