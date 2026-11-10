import { describe, expect, it } from "vitest";
import { capPayout, type Params } from "@capfare/shared";
import example from "../lib/example-params.json";
import { clampCap, HERO, heroQuote } from "../lib/hero";
import { parseBookingUrl } from "../components/app/QuoteClient";

const params = example as unknown as Params;

describe("landing hero example", () => {
  it("pays min(index, paid) − cap − deductible, capped", () => {
    const q = heroQuote(params, 18000);
    expect(q.payout).toBe(capPayout(26000, 25500, 18000, params.cap.deductible, params.cap.max_payout));
    expect(heroQuote(params, 26000).payout).toBe(0);
  });
  it("a higher cap never costs more", () => {
    let last = Infinity;
    for (let c = HERO.minCap; c <= HERO.maxCap; c += 500) {
      const p = heroQuote(params, c).premium;
      expect(p).toBeLessThanOrEqual(last);
      last = p;
    }
  });
  it("clamps and rounds the dragged cap", () => {
    expect(clampCap(1)).toBe(HERO.minCap);
    expect(clampCap(99_999)).toBe(HERO.maxCap);
    expect(clampCap(18_049)).toBe(18_000);
  });
});

describe("booking links", () => {
  it("reads flight details from a demo-site style link", () => {
    expect(parseBookingUrl("https://x.example/book?fn=kl1695&date=2027-06-14&from=ams&to=bcn&fare=economy_light&price=170")).toMatchObject({
      flight_number: "KL1695", airline: "KL", origin: "AMS", destination: "BCN", hint: 17000,
    });
    expect(parseBookingUrl("not a url")).toEqual({});
  });
  it("reads searches from other sites, including share-sheet text and Google Flights", () => {
    expect(parseBookingUrl("Flights to Barcelona https://www.google.com/travel/flights?tfs=CBwQAhoeEgoyMDI3LTA2LTE0agcIARIDQU1TcgcIARIDQkNOGh4SCjIwMjctMDYtMjFqBwgBEgNCQ05yBwgBEgNBTVNAAUgBcAE")).toEqual({
      origin: "AMS", destination: "BCN", departure_date: "2027-06-14", ret: "2027-06-21",
    });
    expect(parseBookingUrl("https://www.skyscanner.example/transport/flights/ams/bcn/270614/?adultsv2=2")).toEqual({ origin: "AMS", destination: "BCN", departure_date: "2027-06-14", pax: 2 });
    expect(parseBookingUrl("https://www.kayak.example/flights/AMS-BCN/2027-06-14")).not.toHaveProperty("flight_number");
  });
});
