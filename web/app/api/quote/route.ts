import { NextResponse, type NextRequest } from "next/server";
import { validateCoverage, type Coverage, type FlightKey } from "@capfare/shared";
import { quoteInputs } from "@/lib/quote";

export const dynamic = "force-dynamic";

/**
 * Quote inputs for a flight or a route; the browser computes the premium with the same public
 * formula and the contract recomputes it at purchase. Body: {coverage | flight_key, product, refresh?}.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { coverage?: Coverage; flight_key?: FlightKey; product: "cap" | "drop"; refresh?: boolean };
  const coverage: Coverage | undefined = b.coverage ?? (b.flight_key ? { flight: b.flight_key } : undefined);
  if (!coverage) return NextResponse.json({ error: "coverage required" }, { status: 400 });
  const err = validateCoverage(coverage);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (b.product === "drop" && "route" in coverage) return NextResponse.json({ error: "a Drop Guarantee covers the flight you booked" }, { status: 400 });
  try {
    const q = await quoteInputs(coverage, b.product, b.refresh !== false);
    if ("error" in q) return NextResponse.json({ error: q.error }, { status: q.status });
    return NextResponse.json(q);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
