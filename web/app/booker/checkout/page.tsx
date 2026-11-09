import { BookerShell, longDate } from "@/components/booker/Shell";
import Checkout from "@/components/booker/Checkout";
import { currentFare, findFlight } from "@/lib/booker/store";
import type { FareId } from "@capfare/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — checkout", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  const pax = Math.min(4, Math.max(1, Number(q.pax ?? 1)));
  const f = findFlight(q.fn ?? "", q.from ?? "", q.to ?? "", q.date ?? "");
  const fare = f?.fares.find((x) => x.id === q.fare);
  if (!f || !fare) return <BookerShell><div className="sk-wrap sk-section"><div className="sk-err">This fare is no longer available.</div></div></BookerShell>;
  const { price } = await currentFare(f, fare.id as FareId);
  return (
    <BookerShell>
      <div className="sk-wrap sk-section">
        <h1 style={{ fontSize: 26 }}>Almost done</h1>
        <Checkout fn={f.flight_number} from={f.origin} to={f.destination} date={f.departure_date} pax={pax} fare={fare.id} fareName={fare.name} price={price} refundable={fare.refundable}
          label={`${f.flight_number} ${f.origin} → ${f.destination}, ${longDate(f.departure_date)}, ${f.dep}–${f.arr}`} />
      </div>
    </BookerShell>
  );
}
