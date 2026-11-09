import { AIRPORTS, listFlights } from "@capfare/shared";
import { BookerShell, eur, longDate } from "@/components/booker/Shell";
import SearchForm from "@/components/booker/SearchForm";
import Results from "@/components/booker/Results";
import { currentFare, findFlight, pricesFor } from "@/lib/booker/store";
import { legOf, tripOf, tripQuery } from "@/lib/booker/trip";
import type { FareId } from "@capfare/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — results", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const t = tripOf(await searchParams);
  const leg = legOf(t);
  const flights = await Promise.all(listFlights(leg.from, leg.to, leg.date).map(async (f) => ({ ...f, live: await pricesFor(f) })));
  const city = (c: string) => AIRPORTS.find((a) => a.code === c)?.city ?? c;
  const out = t.leg === 2 ? findFlight(t.o!, t.from, t.to, t.date) : undefined;
  const outFare = out?.fares.find((x) => x.id === t.of);
  const outPrice = out && outFare ? (await currentFare(out, outFare.id as FareId)).price : 0;
  return (
    <BookerShell>
      <section className="sk-hero" style={{ paddingBottom: 56 }}>
        <div className="sk-wrap">
          <h1>{t.leg === 2 ? "Choose your return flight" : t.ret ? "Choose your outbound flight" : `${city(leg.from)} to ${city(leg.to)}`}</h1>
          <p>
            {city(leg.from)} to {city(leg.to)} · {longDate(leg.date)} · {t.pax} adult{t.pax > 1 ? "s" : ""} · {t.ret ? (t.leg === 2 ? "return flight" : `return, back ${longDate(t.ret)}`) : "one-way"}
          </p>
        </div>
      </section>
      <div className="sk-wrap">
        <SearchForm from={t.from} to={t.to} date={t.date} ret={t.ret} pax={t.pax} />
        {out && outFare ? (
          <div className="sk-note sk-chosen" style={{ marginTop: 14 }}>
            Outbound: <strong>{out.flight_number}</strong> {out.origin} → {out.destination}, {longDate(out.departure_date)} {out.dep}, {outFare.name}, {eur(outPrice)} per person.{" "}
            <a href={`/booker/results?${tripQuery({ ...t, leg: 1, o: undefined, of: undefined })}`}>Change</a>
          </div>
        ) : null}
        <section className="sk-section">
          <Results flights={flights} pax={t.pax} query={tripQuery(t)} />
        </section>
      </div>
    </BookerShell>
  );
}
