import { describe, expect, it } from "vitest";
import { parseBookingLink } from "../src/booking-link.ts";

const now = new Date("2026-11-10T12:00:00Z");

describe("parseBookingLink: links from booking sites", () => {
  it("Google Flights (search kept in the encoded tfs parameter), one way and return", () => {
    expect(parseBookingLink("https://www.google.com/travel/flights/search?tfs=CBwQAhoeEgoyMDI0LTA4LTE1agcIARIDSkZLcgcIARIDTEFYQAFIAXABggELCP___________wGYAQI&hl=en", now)).toMatchObject({ origin: "JFK", destination: "LAX", date: "2024-08-15" });
    expect(parseBookingLink("https://www.google.com/travel/flights?tfs=CBwQAhoeEgoyMDI3LTA2LTE0agcIARIDQU1TcgcIARIDQkNOGh4SCjIwMjctMDYtMjFqBwgBEgNCQ05yBwgBEgNBTVNAAUgBcAE", now)).toMatchObject({ origin: "AMS", destination: "BCN", date: "2027-06-14", return_date: "2027-06-21" });
  });
  it("comparison and agency sites: path and query", () => {
    expect(parseBookingLink("https://www.kayak.example/flights/AMS-BCN/2027-06-14/2027-06-21/2adults?sort=bestflight_a", now)).toMatchObject({ origin: "AMS", destination: "BCN", date: "2027-06-14", return_date: "2027-06-21" });
    expect(parseBookingLink("https://www.skyscanner.example/transport/flights/ams/bcn/270614/?adultsv2=2&childrenv2=7", now)).toMatchObject({ origin: "AMS", destination: "BCN", date: "2027-06-14", travellers: 3 });
    expect(parseBookingLink("https://www.airline.example/booking/search?origin=AMS&destination=BCN&outboundDate=2027-06-14&inboundDate=2027-06-21&adults=1", now)).toMatchObject({ origin: "AMS", destination: "BCN", date: "2027-06-14", return_date: "2027-06-21", travellers: 1 });
    expect(parseBookingLink("https://flightstatus.example/flight/KL1695?date=2027-06-14", now)).toMatchObject({ flight_number: "KL1695", date: "2027-06-14" });
  });
  it("share-sheet text around the link", () => {
    expect(parseBookingLink("Cheap flights Amsterdam – Barcelona https://www.kayak.example/flights/AMS-BCN/2027-06-14 via Kayak", now)).toMatchObject({ origin: "AMS", destination: "BCN", date: "2027-06-14" });
  });
  it("nothing useful", () => {
    expect(parseBookingLink("no link here", now)).toBeNull();
    expect(parseBookingLink("https://www.example.org/about-us", now)).toBeNull();
  });
});
