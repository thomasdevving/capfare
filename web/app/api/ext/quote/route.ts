import { NextResponse, type NextRequest } from "next/server";
import { MAX_SEATS, validateCoverage, type Coverage } from "@capfare/shared";
import { defaultCap, premiumFor, quoteInputs } from "@/lib/quote";
import { networkLabel, serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

type PageFlight = { flight_number: string; departure_date: string; origin: string; destination: string; fare_class: string };
type PageRoute = { origin: string; destination: string; departure_date: string; fare_class?: string };

const day = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Quote for the Chrome extension overlay. The page price is only a hint; this uses the oracle
 * snapshot. Body: {flight | route, product, travellers}. A route (any non-stop flight on the route
 * and day) is for pages that show no flight numbers; it is offered for a Price Cap only.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { flight?: PageFlight; route?: PageRoute; product: "cap" | "drop"; travellers?: number };
  const seats = Math.min(MAX_SEATS, Math.max(1, Math.floor(Number(b.travellers ?? 1)) || 1));
  const product = b.product === "drop" ? "drop" : "cap";
  let coverage: Coverage;
  if (b.flight) {
    const f = b.flight;
    const fn = String(f.flight_number ?? "").toUpperCase();
    coverage = { flight: { airline: fn.slice(0, 2), flight_number: fn, departure_date: f.departure_date, origin: f.origin, destination: f.destination, fare_class: f.fare_class } };
  } else if (b.route) {
    const r = b.route;
    coverage = { route: { origin: r.origin, destination: r.destination, departure_date: r.departure_date, fare_class: r.fare_class ?? "economy_light" } };
  } else return NextResponse.json({ error: "flight or route required" }, { status: 400 });
  const err = validateCoverage(coverage);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (product === "drop" && "route" in coverage) return NextResponse.json({ error: "a Drop Guarantee covers the flight you booked" }, { status: 400 });
  try {
    const q = await quoteInputs(coverage, product);
    if ("error" in q) return NextResponse.json({ error: q.error }, { status: q.status });
    if (!q.snapshot.available) return NextResponse.json({ error: "sold out" }, { status: 409 });
    const strike = product === "cap" ? defaultCap(q.snapshot.price_minor) : q.snapshot.price_minor;
    const p = premiumFor(q, product, strike, seats);
    const pp = q.params[product];
    const r = "flight" in coverage ? coverage.flight : coverage.route;
    return NextResponse.json({
      flight_label: `${"flight" in coverage ? coverage.flight.flight_number : "Any non-stop flight"} ${r.origin}→${r.destination}, ${day(r.departure_date)}`,
      scope: "flight" in coverage ? "flight" : "route",
      price_minor: q.snapshot.price_minor,
      cap_minor: product === "cap" ? strike : undefined,
      premium_minor: p.premium,
      deductible_minor: pp.deductible,
      max_payout_minor: pp.max_payout * seats,
      travellers: seats,
      activation_delay_secs: pp.activation_delay_secs,
      validity_days: Math.round(pp.validity_secs / 86400) || 1,
      demo_price: q.snapshot.demo,
      network: networkLabel(serverConfig().network),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
