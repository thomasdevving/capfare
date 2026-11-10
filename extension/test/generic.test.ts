import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { extractGeneric, extractPage, parseMoney } from "../src/adapters/index.ts";
import { datesIn, flightNumbersIn, parseDateValue, urlHints } from "../src/adapters/generic.ts";

const load = (f: string) => parseHTML(readFileSync(new URL(`./fixtures/generic/${f}`, import.meta.url), "utf8")).document as unknown as Document;
const now = new Date("2026-11-10T12:00:00Z");
const run = (f: string, url: string) => extractGeneric(load(f), new URL(url), { now });

describe("generic adapter: any booking site", () => {
  it("travel-agency results: one flight per priced card, connections and add-ons left out", () => {
    const r = run("ota-search.html", "https://www.exampletrips.example/flights/results?origin=AMS&destination=BCN&departureDate=2027-06-14&adults=2&children=1")!;
    expect(r.kind).toBe("search");
    expect(r.travellers).toBe(3);
    expect(r.route).toEqual({ origin: "AMS", destination: "BCN", departure_date: "2027-06-14" });
    const by = Object.fromEntries(r.flights.map((f) => [f.flight_number, f]));
    expect(Object.keys(by).sort()).toEqual(["HV5131", "KL1695", "VY8306"]);
    expect(by.KL1695).toMatchObject({ origin: "AMS", destination: "BCN", departure_date: "2027-06-14", fare_class: "economy_light", displayed_price_minor: 17200 });
    expect(by.VY8306.displayed_price_minor).toBe(11900); // "<b>VY</b> 8306" split over elements; "+€ 9" seat ignored
    expect(by.HV5131.displayed_price_minor).toBe(123450);
    expect(by.XX9999).toBeUndefined(); // script contents are not page text
  });

  it("results without a date in the address: the day the page is about", () => {
    const r = run("ota-search.html", "https://www.exampletrips.example/flights/results")!;
    expect(r.flights[0].departure_date).toBe("2027-06-14");
    expect(r.route?.origin).toBe("AMS");
    expect(r.travellers).toBe(2);
  });

  it("airline confirmation with schema.org FlightReservation (JSON-LD): booked flight, fare, price, travellers", () => {
    const r = run("airline-confirmation-jsonld.html", "https://www.airline.example/booking/confirmation")!;
    expect(r.kind).toBe("confirmation");
    expect(r.travellers).toBe(2);
    expect(r.flights).toEqual([{ flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_standard", displayed_price_minor: 24500 }]);
  });

  it("comparison site without flight numbers: route and day for route cover", () => {
    const r = run("route-only-search.html", "https://www.flycompare.example/flights/AMS-BCN/2027-06-14?adults=1")!;
    expect(r.flights).toEqual([]);
    expect(r.kind).toBe("search");
    expect(r.route).toEqual({ origin: "AMS", destination: "BCN", departure_date: "2027-06-14" });
    expect(r.travellers).toBe(1);
  });

  it("confirmation page with text only", () => {
    const r = run("text-confirmation.html", "https://www.exampleair.example/booking/done")!;
    expect(r.kind).toBe("confirmation");
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0]).toMatchObject({ flight_number: "HV5131", origin: "AMS", destination: "BCN", departure_date: "2027-06-14", fare_class: "economy_standard" });
    expect(r.travellers).toBe(2);
  });

  it("microdata Flight with an offer", () => {
    const r = run("microdata.html", "https://www.iberia.example/flight")!;
    expect(r.kind).toBe("details");
    expect(r.flights[0]).toMatchObject({ flight_number: "IB3271", origin: "MAD", destination: "LIS", departure_date: "2027-07-02", displayed_price_minor: 8990 });
  });

  it("manage-booking page", () => {
    const r = run("manage.html", "https://www.exampleair.example/manage-booking?ref=ZK4M2Q")!;
    expect(r.kind).toBe("manage");
    expect(r.flights[0]).toMatchObject({ flight_number: "TP1301", origin: "LIS", destination: "OPO", departure_date: "2027-07-07" });
  });

  it("pages that are not about a flight are ignored, even with a route in the address", () => {
    expect(run("not-a-flight.html", "https://news.example/travel/city-breaks")).toBeNull();
    expect(run("not-a-flight.html", "https://hotels.example/AMS-BCN/2027-06-14")).toBeNull();
  });

  it("extractPage: the demo site keeps its own adapter, other sites use the generic one", () => {
    const sky = parseHTML(readFileSync(new URL("./fixtures/search.html", import.meta.url), "utf8")).document as unknown as Document;
    expect(extractPage(sky, new URL("http://localhost:3000/booker/results?from=AMS&to=BCN&date=2027-06-14"))!.adapter.id).toBe("skyline-travel-demo");
    const ota = extractPage(load("ota-search.html"), new URL("https://www.exampletrips.example/flights?origin=AMS&destination=BCN&departureDate=2027-06-14"))!;
    expect(ota.adapter.id).toBe("generic");
    expect(ota.adapter.liveCheck).toBeFalsy();
  });
});

describe("generic adapter: building blocks", () => {
  it("flight numbers: known airlines only, no aircraft types, times or years", () => {
    expect(flightNumbersIn("KL 1695 and FR1234, U2 8801, 4U 0123")).toEqual(["KL1695", "FR1234", "U28801", "4U123"]);
    expect(flightNumbersIn("Airbus A320, A321neo, EU 2024, 10:30 AM 12:45, 30 kg, AB 12, THE 2027")).toEqual([]);
    expect(flightNumbersIn("Aegean A3 602")).toEqual(["A3602"]);
  });
  it("dates in many formats and languages", () => {
    expect(datesIn("14 June 2027 · Jun 15, 2027 · 2027-06-16 · 17/06/2027 · 18 juni 2027 · 19. Juni 2027 · 20 de junio de 2027", now)).toEqual([
      "2027-06-14", "2027-06-15", "2027-06-16", "2027-06-17", "2027-06-18", "2027-06-19", "2027-06-20",
    ]);
    expect(datesIn("Mon 14 Jun", now)).toEqual(["2027-06-14"]); // next one after today
    expect(datesIn("Fri 13 Nov", now)).toEqual(["2026-11-13"]);
    expect(datesIn("06/07/2027", now, true)).toEqual(["2027-06-07"]);
    expect(datesIn("2 may be late, 14 out of 20, 3 days ago", now)).toEqual([]);
  });
  it("address formats", () => {
    expect(parseDateValue("270614", now)).toBe("2027-06-14");
    expect(parseDateValue("20270614", now)).toBe("2027-06-14");
    expect(urlHints(new URL("https://s.example/transport/flights/ams/bcn/270614/?adultsv2=2&childrenv2=5|8"), now)).toEqual({ origin: "AMS", destination: "BCN", date: "2027-06-14", travellers: 4 });
    expect(urlHints(new URL("https://a.example/#/search?from=City:AMS&to=BCN&date=14-06-2027"), now)).toMatchObject({ origin: "AMS", destination: "BCN", date: "2027-06-14" });
  });
  it("prices in common formats", () => {
    expect(parseMoney("€ 1.234,50 · €1,234.50 · 172 € · EUR 99 · £45.99 · 1 234 € · 129,-")).toEqual([
      { minor: 123450, currency: "EUR" }, { minor: 123450, currency: "EUR" }, { minor: 17200, currency: "EUR" }, { minor: 9900, currency: "EUR" },
      { minor: 4599, currency: "GBP" }, { minor: 123400, currency: "EUR" },
    ]);
  });
});
