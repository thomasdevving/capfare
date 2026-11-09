import { BookerShell, longDate } from "@/components/booker/Shell";
import Checkout, { type CheckoutLeg } from "@/components/booker/Checkout";
import { currentFare, findFlight } from "@/lib/booker/store";
import { tripOf } from "@/lib/booker/trip";
import type { FareId } from "@capfare/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — checkout", robots: { index: false } };

async function legFor(fn: string, from: string, to: string, date: string, fareId: string): Promise<CheckoutLeg | null> {
  const f = findFlight(fn, from, to, date);
  const fare = f?.fares.find((x) => x.id === fareId);
  if (!f || !fare) return null;
  const { price } = await currentFare(f, fare.id as FareId);
  return { fn: f.flight_number, from: f.origin, to: f.destination, date: f.departure_date, fare: fare.id, fareName: fare.name, price, refundable: fare.refundable, label: `${f.flight_number} ${f.origin} → ${f.destination}, ${longDate(f.departure_date)}, ${f.dep}–${f.arr}` };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  const t = tripOf(q);
  const out = await legFor(q.fn ?? "", t.from, t.to, t.date, q.fare ?? "");
  const ret = t.ret && q.rfn ? await legFor(q.rfn, t.to, t.from, t.ret, q.rfare ?? "") : null;
  if (!out || (t.ret && q.rfn && !ret)) return <BookerShell><div className="sk-wrap sk-section"><div className="sk-err">This fare is no longer available.</div></div></BookerShell>;
  return (
    <BookerShell>
      <div className="sk-wrap sk-section">
        <h1 style={{ fontSize: 26 }}>Almost done</h1>
        <Checkout pax={t.pax} legs={ret ? [out, ret] : [out]} />
      </div>
    </BookerShell>
  );
}
