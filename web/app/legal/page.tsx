import AppPage from "@/components/app/AppPage";
import { en } from "@/lib/i18n/en";
export const metadata = { title: "Legal and FAQ — CapFare" };
export default function Page() {
  return (
    <AppPage title="Legal and FAQ">
      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Testnet prototype</h2>
        <p>CapFare runs on NEAR testnet (or a local sandbox for demos) with test USDC that has no value. No real money is accepted or paid out, fiat top-ups and IBAN payouts are simulated, and NEAR Intents is only used for dry-run quotes.</p>
        <p>CapFare is price protection, not insurance. A commercial launch would require partnering with a licensed insurer or another appropriately licensed financial partner, and a licensed payment provider for euro top-ups and payouts.</p>
        <p>Prices in demo deployments come from a scripted price source and are labelled as such. Booking emails in demos are synthetic test confirmations.</p>
      </section>
      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>What is covered</h2>
        <ul className="fine">
          <li>One exact flight number, departure date, fare class and airport pair.</li>
          <li>Price Cap: bookings made between activation and expiry; payout uses the airline&apos;s price at booking time and what you paid, whichever is lower.</li>
          <li>Drop Guarantee: drops of the airline&apos;s price for the same flight during the window after your purchase.</li>
        </ul>
        <h2 style={{ fontSize: "var(--s4)" }}>What is not covered</h2>
        <ul className="fine">
          <li>Seat availability. If the fare class sells out, a cap cannot be used; with sold-out refunds switched on, the premium is refunded.</li>
          <li>Other flights, dates or fare classes, taxes added after booking, baggage and seat fees.</li>
          <li>Bookings you cancel. Refundable tickets are checked one day before departure.</li>
        </ul>
        <h2 style={{ fontSize: "var(--s4)" }}>Deductibles and activation delays</h2>
        <p>Each payout is reduced by a deductible, and a Price Cap only counts bookings made after its activation delay. These rules keep premiums low by making it pointless to buy protection seconds before booking at a price you already know.</p>
      </section>
      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Personal data</h2>
        <p>Booking emails and references are encrypted on your device for the booking checker. Only flight, date, fare class, price, refundability, booking time and an anonymous booking fingerprint (nullifier) leave it. We use no tracking cookies and no third-party analytics.</p>
      </section>
      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>{en.faq.title}</h2>
        <dl className="faq">
          {en.faq.items.map((f) => (
            <div key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </AppPage>
  );
}
