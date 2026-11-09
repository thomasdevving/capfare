import { describe, expect, it } from "vitest";
import { listFlights, modelFare, normalizeLastName, passengerCommitment } from "../src/index.ts";

describe("passenger commitment", () => {
  const salt = "ab".repeat(32);
  it("normalises names", () => {
    expect(normalizeLastName("  de Vries-Jansen ")).toBe("devriesjansen");
    expect(normalizeLastName("Müller")).toBe("muller");
  });
  it("is stable and salt-dependent", () => {
    expect(passengerCommitment("Jansen", salt)).toBe(passengerCommitment("JANSEN", salt));
    expect(passengerCommitment("Jansen", salt)).not.toBe(passengerCommitment("Jansen", "cd".repeat(32)));
    expect(passengerCommitment("Jansen", salt)).not.toBe(passengerCommitment("Janssen", salt));
  });
});

describe("demo fare model", () => {
  it("is deterministic and includes the anchor flight", () => {
    const a = listFlights("AMS", "BCN", "2027-06-14");
    expect(a).toEqual(listFlights("AMS", "BCN", "2027-06-14"));
    const kl = a.find((f) => f.flight_number === "KL1695")!;
    expect(kl.dep).toBe("07:20");
    expect(kl.departure_ts).toBe(1812950400);
    expect(a.length).toBeGreaterThanOrEqual(5);
    for (const f of a) expect(f.fares[2].price_minor).toBeGreaterThan(f.fares[0].price_minor);
  });
  it("prices a flight key", () => {
    const f = listFlights("RTM", "AGP", "2027-07-03")[0];
    const m = modelFare({ airline: f.airline, flight_number: f.flight_number, departure_date: f.departure_date, origin: "RTM", destination: "AGP", fare_class: "economy_flex" })!;
    expect(m.price_minor).toBe(f.fares[2].price_minor);
    expect(m.refundable).toBe(true);
    expect(listFlights("AMS", "AMS", "2027-07-03")).toEqual([]);
  });
});
