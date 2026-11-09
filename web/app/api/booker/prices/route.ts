import { NextResponse, type NextRequest } from "next/server";
import { listFlights } from "@capfare/shared";
import { pricesFor } from "@/lib/booker/store";
export const dynamic = "force-dynamic";
/** Current fares for a route/date (oracle snapshot where CapFare has one, else the demo model). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const flights = listFlights(q.get("from") ?? "", q.get("to") ?? "", q.get("date") ?? "");
  const out = await Promise.all(flights.map(async (f) => ({ ...f, live: await pricesFor(f) })));
  return NextResponse.json(out);
}
