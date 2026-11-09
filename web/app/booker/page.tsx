import Link from "next/link";
import { listFlights } from "@capfare/shared";
import { BookerShell, eur } from "@/components/booker/Shell";
import SearchForm from "@/components/booker/SearchForm";

export const metadata = { title: "Skyline Travel (demo) — flights", robots: { index: false } };

const POPULAR = [
  ["AMS", "BCN", "Barcelona", "2027-06-14"],
  ["AMS", "LIS", "Lisbon", "2027-05-21"],
  ["RTM", "AGP", "Málaga", "2027-07-03"],
  ["AMS", "FCO", "Rome", "2027-04-16"],
] as const;

export default function Page() {
  return (
    <BookerShell>
      <section className="sk-hero">
        <div className="sk-wrap">
          <h1>Find your next flight</h1>
          <p>Compare airlines and fares, book in a few steps. (Demo site.)</p>
        </div>
      </section>
      <div className="sk-wrap">
        <SearchForm />
        <section className="sk-section">
          <h2>Popular from the Netherlands</h2>
          <div className="sk-cards">
            {POPULAR.map(([from, to, city, date]) => {
              const cheapest = Math.min(...listFlights(from, to, date).map((f) => f.fares[0].price_minor));
              return (
                <Link key={to} className="sk-card sk-route-card" href={`/booker/results?from=${from}&to=${to}&date=${date}&pax=1`}>
                  <strong>{city}</strong>
                  <span>{from} → {to}, {date}</span>
                  <p style={{ margin: "8px 0 0" }}>from <strong style={{ display: "inline" }}>{eur(cheapest)}</strong></p>
                </Link>
              );
            })}
          </div>
        </section>
        <section className="sk-section">
          <div className="sk-note">
            Testing CapFare? Search, book a flight with any test card number and you&apos;ll find the confirmation email in the <Link href="/booker/inbox">demo inbox</Link>. Manage or cancel it under <Link href="/booker/trips">My trips</Link>.
          </div>
        </section>
      </div>
    </BookerShell>
  );
}
