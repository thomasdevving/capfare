import { NextResponse, type NextRequest } from "next/server";
import { validateFlightKey, type FlightKey } from "@capfare/shared";
import { defaultCap, premiumFor, quoteInputs } from "@/lib/quote";
import { networkLabel, serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Quote for the Chrome extension overlay. The page price is only a hint; this uses the oracle snapshot. */
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { flight: { flight_number: string; departure_date: string; origin: string; destination: string; fare_class: string }; product: "cap" | "drop" };
  const f = b.flight;
  const fk: FlightKey = { airline: f.flight_number.slice(0, 2), flight_number: f.flight_number, departure_date: f.departure_date, origin: f.origin, destination: f.destination, fare_class: f.fare_class };
  const err = validateFlightKey(fk);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    const q = await quoteInputs(fk, b.product);
    if ("error" in q) return NextResponse.json({ error: q.error }, { status: q.status });
    if (!q.snapshot.available) return NextResponse.json({ error: "sold out" }, { status: 409 });
    const strike = b.product === "cap" ? defaultCap(q.snapshot.price_minor) : q.snapshot.price_minor;
    const p = premiumFor(q, b.product, strike);
    const pp = q.params[b.product];
    return NextResponse.json({
      flight_label: `${fk.flight_number} ${fk.origin}→${fk.destination}, ${new Date(fk.departure_date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
      price_minor: q.snapshot.price_minor,
      cap_minor: b.product === "cap" ? strike : undefined,
      premium_minor: p.premium,
      deductible_minor: pp.deductible,
      max_payout_minor: pp.max_payout,
      activation_delay_secs: pp.activation_delay_secs,
      validity_days: Math.round(pp.validity_secs / 86400) || 1,
      demo_price: q.snapshot.demo,
      network: networkLabel(serverConfig().network),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
