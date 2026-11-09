import { NextResponse, type NextRequest } from "next/server";
import { validateFlightKey, type FlightKey } from "@capfare/shared";
import { quoteInputs } from "@/lib/quote";

export const dynamic = "force-dynamic";

/** Quote inputs; the browser computes the premium with the same public formula and the contract recomputes it at purchase. */
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { flight_key: FlightKey; product: "cap" | "drop"; refresh?: boolean };
  const err = validateFlightKey(b.flight_key);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    const q = await quoteInputs(b.flight_key, b.product, b.refresh !== false);
    if ("error" in q) return NextResponse.json({ error: q.error }, { status: q.status });
    return NextResponse.json(q);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
