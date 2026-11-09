import { DemoShell, euro, farePrices, FARES, FLIGHT } from "./shared";
export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — search", robots: { index: false } };

export default async function Page() {
  const prices = await farePrices();
  return (
    <DemoShell>
      <div className="demo-search">
        <span>From <strong>Amsterdam (AMS)</strong></span>
        <span>To <strong>Barcelona (BCN)</strong></span>
        <span>Departure <strong>Mon 14 June 2027</strong></span>
        <span>1 adult</span>
      </div>
      <article className="flight-card">
        <div className="fl-top">
          <span className="fl-number">{FLIGHT.fn}</span>
          <span className="fl-route">{FLIGHT.from} {FLIGHT.dep} → {FLIGHT.to} {FLIGHT.arr}</span>
          <time dateTime={`${FLIGHT.date}T${FLIGHT.dep}`}>14 Jun 2027</time>
          <span>Direct · 2h 20m</span>
        </div>
        <div className="fares">
          {FARES.map((f) => {
            const p = prices[f.id];
            return (
              <div className="fare" key={f.id}>
                <span className="fare-name">{f.name}</span>
                {p.available ? <span className="fare-price">{euro(p.price)}</span> : <span className="sold">Sold out</span>}
                <small>{f.note}</small>
                <br />
                {p.available ? <a href={`/demo-airline/flight?fare=${f.id}`}>Select</a> : null}
              </div>
            );
          })}
        </div>
      </article>
    </DemoShell>
  );
}
