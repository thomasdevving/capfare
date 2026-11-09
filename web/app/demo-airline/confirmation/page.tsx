import { DemoShell, euro, farePrices, FARES, FLIGHT } from "../shared";
export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — booked", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ fare?: string }> }) {
  const { fare = "economy_standard" } = await searchParams;
  const f = FARES.find((x) => x.id === fare) ?? FARES[1];
  const p = (await farePrices())[f.id];
  return (
    <DemoShell>
      <section className="booking-confirmed">
        <h1>Your trip is booked</h1>
        <p style={{ fontFamily: "system-ui, sans-serif" }}>A confirmation email is on its way. (Demo: no email is sent and no seat is reserved.)</p>
        <div className="fl-top">
          <span className="fl-number">{FLIGHT.fn}</span>
          <span className="fl-route">{FLIGHT.from} {FLIGHT.dep} → {FLIGHT.to} {FLIGHT.arr}</span>
          <time dateTime={`${FLIGHT.date}T${FLIGHT.dep}`}>14 Jun 2027</time>
        </div>
        <div className="fares" style={{ gridTemplateColumns: "1fr" }}>
          <div className="fare">
            <span className="fare-name">{f.name}</span>
            <span className="fare-price">{euro(p.price)}</span>
            <small>Total paid, 1 adult</small>
          </div>
        </div>
      </section>
    </DemoShell>
  );
}
