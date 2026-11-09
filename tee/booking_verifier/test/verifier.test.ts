import { beforeAll, describe, expect, it } from "vitest";
import { flightKeyHash, verifyAttestation, type FlightKey } from "@capfare/shared";
import { devKeys } from "@capfare/tee-common";
import { DemoAirline, DemoKeys, demoResolver, klm, makeFixtureEml, nullifier, parseKlmText, verifyOriginalEml, Verifier } from "../src/index.ts";

const fk: FlightKey = { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };
const base = {
  booking_ref: "QX7K2P",
  last_name: "Jansen",
  flight_number: "KL1695",
  departure_date: "2027-06-14",
  origin: "AMS",
  destination: "BCN",
  fare_label: "Economy Light",
  paid_price_minor: 25500,
  refundable: "non_refundable" as const,
  booked_at: new Date("2026-11-20T10:00:00Z"),
};

let keys: DemoKeys;
let verifier: Verifier;
let airline: DemoAirline;

beforeAll(() => {
  process.env.CAPFARE_DEPLOYMENT = "test";
  keys = new DemoKeys();
  airline = new DemoAirline();
  verifier = new Verifier({ keys: devKeys("booking_verifier"), airlines: [klm], resolver: demoResolver(keys), statusCheckers: { KL: (r, l) => airline.checkStatus(r, l) }, now: () => 1_795_000_000 });
});

describe("DKIM path", () => {
  it("accepts a valid original email and emits a PII-free attestation", async () => {
    const { eml } = await makeFixtureEml(base, keys);
    const { attestation, flight_key } = await verifier.verifyEml(eml, fk);
    expect(verifyAttestation(attestation)).toBe(true);
    expect(flight_key).toEqual(fk);
    const a = attestation.attestation;
    expect(a.flight_key_hash).toBe(flightKeyHash(fk));
    expect(a.paid_price_minor).toBe(25500);
    expect(a.refundable).toBe("non_refundable");
    expect(a.method).toBe("dkim_eml");
    expect(a.booked_at).toBe(Math.floor(base.booked_at.getTime() / 1000));
    const json = JSON.stringify(attestation);
    expect(json).not.toMatch(/QX7K2P|Jansen|JANSEN|traveller@example/);
  });

  it("rejects a modified email (body hash)", async () => {
    const { eml } = await makeFixtureEml(base, keys);
    const tampered = eml.replace("Total price: EUR 255.00", "Total price: EUR 955.00");
    await expect(verifier.verifyEml(tampered, fk)).rejects.toThrow(/DKIM check failed/);
  });

  it("rejects a forwarded email", async () => {
    const { eml } = await makeFixtureEml({ ...base, subject_prefix: "Fwd: " }, keys);
    await expect(verifier.verifyEml(eml, fk)).rejects.toThrow(/forwarded/);
    const { eml: e2 } = await makeFixtureEml(base, keys);
    const resent = e2.replace("To: traveller@example.org", "To: traveller@example.org\r\nX-Forwarded-To: other@example.org");
    await expect(verifier.verifyEml(resent, fk)).rejects.toThrow(/forwarded/);
  });

  it("rejects mail re-signed by the user's mail provider (forward from gmail.com)", async () => {
    const { eml } = await makeFixtureEml({ ...base, from_domain: "gmail.com" }, keys, "gmail.com");
    await expect(verifier.verifyEml(eml, fk)).rejects.toThrow(/not a supported airline/);
  });

  it("rejects a wrong signing domain even with an airline From address", async () => {
    const { eml } = await makeFixtureEml({ ...base, from_domain: "klm.com" }, keys, "klm-deals.example");
    await expect(verifier.verifyEml(eml, fk)).rejects.toThrow(/DKIM check failed|not DKIM-signed/);
  });

  it("rejects unsigned mail", async () => {
    const { eml } = await makeFixtureEml(base, keys);
    const unsigned = eml.replace(/^DKIM-Signature:[\s\S]*?\r\n(?=From:)/, "");
    expect(unsigned.startsWith("From:")).toBe(true);
    await expect(verifier.verifyEml(unsigned, fk)).rejects.toThrow(/not DKIM-signed/);
  });

  it("rejects a booking for another flight or fare class", async () => {
    const { eml } = await makeFixtureEml(base, keys);
    await expect(verifier.verifyEml(eml, { ...fk, fare_class: "economy_standard" })).rejects.toThrow(/does not contain the covered flight/);
  });

  it("verifyOriginalEml exposes the reason", async () => {
    const { eml } = await makeFixtureEml(base, keys);
    const r = await verifyOriginalEml(eml, ["klm.com"], { resolver: demoResolver(keys) });
    expect(r.ok).toBe(true);
  });
});

describe("status path", () => {
  it("reads the manage-booking page and reports cancellation", async () => {
    const f = await makeFixtureEml(base, keys);
    airline.register(f.booking_ref, f.last_name, f.eml.split("\r\n\r\n").slice(1).join("\r\n\r\n"));
    const r1 = await verifier.verifyStatus("KL", f.booking_ref, f.last_name, fk);
    expect(r1.attestation.attestation.status).toBe("active");
    expect(r1.attestation.attestation.method).toBe("status_check");
    airline.setStatus(f.booking_ref, "cancelled");
    const r2 = await verifier.verifyStatus("KL", f.booking_ref, f.last_name, fk);
    expect(r2.attestation.attestation.status).toBe("cancelled");
    // Same booking => same nullifier on both paths.
    const viaEml = await verifier.verifyEml(f.eml, fk);
    expect(viaEml.attestation.attestation.booking_ref_nullifier).toBe(r2.attestation.attestation.booking_ref_nullifier);
    await expect(verifier.verifyStatus("KL", f.booking_ref, "Wrong", fk)).rejects.toThrow(/not found/);
  });

  it("nullifier depends on the enclave salt", () => {
    expect(nullifier(new Uint8Array(32), "KL", "ABC123")).not.toBe(nullifier(new Uint8Array(32).fill(1), "KL", "ABC123"));
    expect(nullifier(new Uint8Array(32), "KL", "abc123 ")).toBe(nullifier(new Uint8Array(32), "KL", "ABC123"));
  });
});

describe("template parser", () => {
  it("parses refundability and price formats", () => {
    const t = "Booking code: ABC123\nKL1695 · 14 Jun 2027 · Amsterdam (AMS) → Barcelona (BCN) · Economy Flex\nTotal price: EUR 1.234,50\nThis is a fully refundable ticket.";
    const b = parseKlmText(t)!;
    expect(b.paid_price_minor).toBe(123450);
    expect(b.refundable).toBe("refundable");
    expect(b.segments[0].fare_class).toBe("economy_flex");
  });
});
