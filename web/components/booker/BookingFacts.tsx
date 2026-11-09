import type { Booking } from "@/lib/booker/store";
import { eur, longDate } from "./Shell";

/** Booking details as shown on the confirmation and manage pages (also what verifiers read). */
export default function BookingFacts({ b }: { b: Booking }) {
  const lead = b.passengers[0];
  return (
    <dl className="sk-facts booking-facts">
      <dt>Booking code</dt><dd data-k="ref">{b.ref}</dd>
      <dt>Status</dt><dd data-k="status"><span className={`sk-status ${b.status}`}>{b.status === "confirmed" ? "Confirmed" : "Cancelled"}</span></dd>
      <dt>Lead passenger</dt><dd data-k="lead">{lead.title} {lead.first} <span className="sk-last">{lead.last}</span></dd>
      <dt>Passengers</dt><dd data-k="pax">{b.passengers.length}</dd>
      <dt>Flight</dt><dd data-k="flight"><span className="sk-fn">{b.flight.flight_number}</span> ({b.flight.airlineName})</dd>
      <dt>Route</dt><dd data-k="route"><span className="sk-route">{b.flight.origin} → {b.flight.destination}</span></dd>
      <dt>Departure</dt><dd data-k="departure"><time dateTime={`${b.flight.departure_date}T${b.flight.dep}`}>{longDate(b.flight.departure_date)}, {b.flight.dep}</time></dd>
      <dt>Fare</dt><dd data-k="fare" className="fare-name">{b.fare.name}</dd>
      <dt>Ticket type</dt><dd data-k="ticket">{b.fare.refundable ? "Refundable" : "Non-refundable"}</dd>
      <dt>Price per passenger</dt><dd data-k="price" className="fare-price">{eur(b.pricePerPassenger)}</dd>
      <dt>Total paid</dt><dd data-k="total">{eur(b.total)} (card ending {b.cardLast4})</dd>
      <dt>Booked on</dt><dd data-k="booked"><time dateTime={new Date(b.createdAt * 1000).toISOString()}>{new Date(b.createdAt * 1000).toUTCString()}</time></dd>
    </dl>
  );
}
