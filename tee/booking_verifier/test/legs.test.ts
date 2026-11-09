import { describe, expect, it } from "vitest";
import { flightKeyHash, verifyAttestation } from "@capfare/shared";
import { devKeys } from "@capfare/tee-common";
import { parseKlmText, parseSkylineEmail, parseSkylineManagePage, skyline, Verifier } from "../src/index.ts";
import type { ParsedBooking } from "../src/airlines/types.ts";

const SALT = "3c".repeat(32);

const RETURN_EMAIL = [
  "Booking code: K7QX2M",
  "Lead passenger: JANSEN/ANNA MS",
  "Passengers: 2",
  "Trip: Return",
  "Outbound flight: KL1695 Amsterdam (AMS) to Barcelona (BCN)",
  "Outbound date: 14 Jun 2027, departs 07:20, arrives 09:40",
  "Outbound fare: Economy Light",
  "Outbound ticket type: Non-refundable",
  "Outbound price per passenger: EUR 170.00",
  "Return flight: VY8302 Barcelona (BCN) to Amsterdam (AMS)",
  "Return date: 21 Jun 2027, departs 18:05, arrives 20:30",
  "Return fare: Economy Flex",
  "Return ticket type: Refundable",
  "Return price per passenger: EUR 245.00",
  "Total paid: EUR 830.00 (card ending 4242)",
].join("\r\n");

const RETURN_PAGE = `<dl class="sk-facts booking-facts">
<dt>Booking code</dt><dd data-k="ref">K7QX2M</dd>
<dt>Status</dt><dd data-k="status"><span class="sk-status confirmed">Confirmed</span></dd>
<dt>Lead passenger</dt><dd data-k="lead">Ms Anna <span class="sk-last">Jansen</span></dd>
<dt>Passengers</dt><dd data-k="pax">2</dd>
<dt>Flight</dt><dd data-k="flight"><span class="sk-fn">KL1695</span> (KLM)</dd>
<dt>Route</dt><dd data-k="route"><span class="sk-route">AMS → BCN</span></dd>
<dt>Departure</dt><dd data-k="departure"><time datetime="2027-06-14T07:20">Mon 14 Jun 2027, 07:20</time></dd>
<dt>Fare</dt><dd data-k="fare">Economy Light</dd>
<dt>Ticket type</dt><dd data-k="ticket">Non-refundable</dd>
<dt>Price per passenger</dt><dd data-k="price">€ 170</dd>
<dt>Return flight</dt><dd data-k="flight-2"><span class="sk-fn">VY8302</span> (Vueling)</dd>
<dt>Return route</dt><dd data-k="route-2"><span class="sk-route">BCN → AMS</span></dd>
<dt>Return departure</dt><dd data-k="departure-2"><time datetime="2027-06-21T18:05">Mon 21 Jun 2027, 18:05</time></dd>
<dt>Return fare</dt><dd data-k="fare-2">Economy Flex</dd>
<dt>Return ticket type</dt><dd data-k="ticket-2">Refundable</dd>
<dt>Return price per passenger</dt><dd data-k="price-2">€ 245</dd>
<dt>Booked on</dt><dd data-k="booked"><time datetime="2027-05-01T10:00:00.000Z">x</time></dd>
</dl>`;

const OUT = { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };
const BACK = { airline: "VY", flight_number: "VY8302", departure_date: "2027-06-21", origin: "BCN", destination: "AMS", fare_class: "economy_flex" };

function verifierWith(booking: ParsedBooking) {
  process.env.CAPFARE_DEPLOYMENT = "test";
  return new Verifier({
    keys: devKeys("booking_verifier"),
    airlines: [skyline],
    statusCheckers: { SKY: async () => ({ status: "active", booking }) },
    now: () => 1_795_000_000,
  });
}

describe("return trips and travellers", () => {
  it("parses both legs of a return confirmation email, with prices per flight", () => {
    const b = parseSkylineEmail(RETURN_EMAIL)!;
    expect(b.passengers).toBe(2);
    expect(b.segments).toHaveLength(2);
    expect(b.segments[0]).toMatchObject({ flight_number: "KL1695", paid_price_minor: 17_000, refundable: "non_refundable" });
    expect(b.segments[1]).toMatchObject({ flight_number: "VY8302", origin: "BCN", fare_class: "economy_flex", paid_price_minor: 24_500, refundable: "refundable" });
  });

  it("reads both legs from the manage-booking page", () => {
    const p = parseSkylineManagePage(RETURN_PAGE)!;
    expect(p.booking.passengers).toBe(2);
    expect(p.booking.segments.map((s) => [s.flight_number, s.paid_price_minor, s.refundable])).toEqual([
      ["KL1695", 17_000, "non_refundable"],
      ["VY8302", 24_500, "refundable"],
    ]);
  });

  it("attests each leg separately with its own price, ticket type and the traveller count", async () => {
    const v = verifierWith(parseSkylineEmail(RETURN_EMAIL)!);
    const out = await v.verifyStatus("SKY", "K7QX2M", "Jansen", SALT, OUT);
    const back = await v.verifyStatus("SKY", "K7QX2M", "Jansen", SALT, BACK);
    for (const r of [out, back]) expect(verifyAttestation(r.attestation)).toBe(true);
    expect(out.attestation.attestation).toMatchObject({ flight_key_hash: flightKeyHash(OUT), paid_price_minor: 17_000, refundable: "non_refundable", seats: 2 });
    expect(back.attestation.attestation).toMatchObject({ flight_key_hash: flightKeyHash(BACK), paid_price_minor: 24_500, refundable: "refundable", seats: 2 });
    // Same booking, same nullifier: the chain spends it per flight.
    expect(out.attestation.attestation.booking_ref_nullifier).toBe(back.attestation.attestation.booking_ref_nullifier);
    await expect(v.verifyStatus("SKY", "K7QX2M", "Jansen", SALT)).rejects.toThrow(/several flights/);
  });

  it("picks the flight on a covered route and day for route coverage", async () => {
    const v = verifierWith(parseSkylineEmail(RETURN_EMAIL)!);
    const r = await v.verifyStatus("SKY", "K7QX2M", "Jansen", SALT, { origin: "BCN", destination: "AMS", departure_date: "2027-06-21", fare_class: "economy_flex" });
    expect(r.flight_key).toEqual(BACK);
    await expect(v.verifyStatus("SKY", "K7QX2M", "Jansen", SALT, { origin: "BCN", destination: "AMS", departure_date: "2027-06-22", fare_class: "economy_flex" })).rejects.toThrow(/no flight on the covered route/);
  });

  it("refuses to split one total over several flights", async () => {
    const b = parseSkylineEmail(RETURN_EMAIL)!;
    const noLegPrices: ParsedBooking = { ...b, segments: b.segments.map(({ paid_price_minor: _p, ...s }) => s) };
    await expect(verifierWith(noLegPrices).verifyStatus("SKY", "K7QX2M", "Jansen", SALT, OUT)).rejects.toThrow(/price of each flight/);
  });

  it("KLM: the total covers all travellers", () => {
    const text = [
      "Booking code: ABC123",
      "Passenger: JANSEN/ANNA MS",
      "Passengers: 3",
      "KL1695 · 14 Jun 2027 · Amsterdam (AMS) → Barcelona (BCN) · Economy Light",
      "Total price: EUR 510.00",
    ].join("\n");
    const b = parseKlmText(text)!;
    expect(b.passengers).toBe(3);
    expect(b.paid_price_minor).toBe(17_000);
    expect(b.last_name).toBe("JANSEN");
  });
});
