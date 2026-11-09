import { DemoShell, euro, farePrices, FARES, FLIGHT } from "../shared";
export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — flight", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ fare?: string }> }) {
  const { fare = "economy_light" } = await searchParams;
  const f = FARES.find((x) => x.id === fare) ?? FARES[0];
  const p = (await farePrices())[f.id];
  return (
    <DemoShell>
      <article className="flight-card">
        <div className="fl-top">
          <span className="fl-number">{FLIGHT.fn}</span>
          <span className="fl-route">{FLIGHT.from} {FLIGHT.dep} → {FLIGHT.to} {FLIGHT.arr}</span>
          <time dateTime={`${FLIGHT.date}T${FLIGHT.dep}`}>14 Jun 2027</time>
        </div>
        <div className="fares" style={{ gridTemplateColumns: "1fr" }}>
          <div className="fare">
            <span className="fare-name">{f.name}</span>
            <span className="fare-price">{euro(p.price)}</span>
            <small>{f.note}. Price for 1 adult including taxes.</small>
            <br />
            <a href={`/demo-airline/confirmation?fare=${f.id}`}>Book now</a>
          </div>
        </div>
      </article>
    </DemoShell>
  );
}
