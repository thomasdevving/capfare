import { AIRPORTS, listFlights } from "@capfare/shared";
import { BookerShell, longDate } from "@/components/booker/Shell";
import SearchForm from "@/components/booker/SearchForm";
import Results from "@/components/booker/Results";
import { pricesFor } from "@/lib/booker/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — results", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  const from = q.from ?? "AMS", to = q.to ?? "BCN", date = q.date ?? "2027-06-14", pax = Math.min(4, Math.max(1, Number(q.pax ?? 1)));
  const flights = await Promise.all(listFlights(from, to, date).map(async (f) => ({ ...f, live: await pricesFor(f) })));
  const city = (c: string) => AIRPORTS.find((a) => a.code === c)?.city ?? c;
  return (
    <BookerShell>
      <section className="sk-hero" style={{ paddingBottom: 56 }}>
        <div className="sk-wrap">
          <h1>{city(from)} to {city(to)}</h1>
          <p>{longDate(date)} · {pax} adult{pax > 1 ? "s" : ""} · one-way</p>
        </div>
      </section>
      <div className="sk-wrap">
        <SearchForm from={from} to={to} date={date} pax={pax} />
        <section className="sk-section">
          <Results flights={flights} pax={pax} query={`from=${from}&to=${to}&date=${date}&pax=${pax}`} />
        </section>
      </div>
    </BookerShell>
  );
}
