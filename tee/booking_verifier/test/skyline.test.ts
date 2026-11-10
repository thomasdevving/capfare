import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { passengerCommitment, verifyAttestation } from "@capfare/shared";
import { devKeys } from "@capfare/tee-common";
import { parseSkylineEmail, parseSkylineManagePage, skyline, Verifier } from "../src/index.ts";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const SALT = "3c".repeat(32);
const ORIGIN = "http://localhost:3000";
const dkim = JSON.parse(fx("skyline-dkim.json")) as { record: string };

let v: Verifier;
const pages: Record<string, string> = {};

beforeAll(() => {
  process.env.CAPFARE_DEPLOYMENT = "test";
  v = new Verifier({
    keys: devKeys("booking_verifier"),
    airlines: [skyline],
    resolver: async (name: string, rr: string) => {
      if (rr === "TXT" && name === "skyline._domainkey.skyline-travel.example") return [[dkim.record]];
      throw Object.assign(new Error("nx"), { code: "ENOTFOUND" });
    },
    pageOrigins: [ORIGIN],
    fetchImpl: (async (u: string) => {
      const html = pages[new URL(u).searchParams.get("t") ?? ""];
      return html ? new Response(html, { status: 200 }) : new Response("not found", { status: 404 });
    }) as typeof fetch,
    now: () => 1_795_000_000,
  });
  pages.active = fx("skyline-manage.html");
  pages.cancelled = fx("skyline-manage-cancelled.html");
});

describe("Skyline Travel (demo) emails", () => {
  it("parses the confirmation template with a multi-word surname", () => {
    const b = parseSkylineEmail(fx("skyline-confirmation.eml"))!;
    expect(b.last_name).toBe("DE VRIES");
    expect(b.segments[0]).toMatchObject({ flight_number: "KL1695", origin: "AMS", destination: "BCN", departure_date: "2027-06-14", fare_class: "economy_light" });
    expect(b.refundable).toBe("non_refundable");
  });
  it("verifies the DKIM-signed original and binds the passenger", async () => {
    const r = await v.verifyEml(fx("skyline-confirmation.eml"), SALT);
    expect(verifyAttestation(r.attestation)).toBe(true);
    expect(r.attestation.attestation.method).toBe("dkim_eml");
    expect(r.attestation.attestation.passenger_commitment).toBe(passengerCommitment("de Vries", SALT));
  });
  it("rejects an edited email", async () => {
    const edited = fx("skyline-confirmation.eml").replace(/Price per passenger: EUR [0-9.]+/, "Price per passenger: EUR 999.00");
    await expect(v.verifyEml(edited, SALT)).rejects.toThrow(/DKIM check failed/);
  });
});

describe("live check of the manage-booking page", () => {
  it("reads an active booking from the page", () => {
    const p = parseSkylineManagePage(pages.active)!;
    expect(p.status).toBe("active");
    expect(p.booking.last_name).toBe("de Vries");
    expect(p.booking.paid_price_minor).toBeGreaterThan(0);
  });
  it("attests the booking as it is now (tls_page), same passenger commitment as the email", async () => {
    const t = new URL(fx("skyline-manage.html").match(/\/booker\/manage\?ref=[A-Z0-9]+&amp;t=([0-9a-f]+)/)?.[0]?.replace("&amp;", "&") ?? "http://x/?t=active", ORIGIN).searchParams.get("t");
    const url = `${ORIGIN}/booker/manage?ref=X&t=${t && pages[t] ? t : "active"}`;
    const r = await v.verifyPage(url, SALT);
    expect(verifyAttestation(r.attestation)).toBe(true);
    const a = r.attestation.attestation;
    expect(a.method).toBe("tls_page");
    expect(a.status).toBe("active");
    expect(a.passenger_commitment).toBe(passengerCommitment("de Vries", SALT));
    const email = await v.verifyEml(fx("skyline-confirmation.eml"), SALT);
    expect(a.booking_ref_nullifier).toBe(email.attestation.attestation.booking_ref_nullifier);
  });
  it("reports a cancellation", async () => {
    const r = await v.verifyPage(`${ORIGIN}/booker/manage?ref=X&t=cancelled`, SALT);
    expect(r.attestation.attestation.status).toBe("cancelled");
    expect(r.attestation.attestation.refundable).toBe("refundable");
  });
  it("only fetches allowlisted booking sites", async () => {
    await expect(v.verifyPage("https://evil.example/booker/manage?t=active", SALT)).rejects.toThrow(/not available for this website/);
    await expect(v.verifyPage(`${ORIGIN}/somewhere-else`, SALT)).rejects.toThrow(/manage page/);
    await expect(v.verifyPage(`${ORIGIN}/booker/manage?t=missing`, SALT)).rejects.toThrow(/answered 404/);
  });
});

describe("hosted demo: public booking links", () => {
  it("accepts the public address and fetches the same page inside the container", async () => {
    const seen: string[] = [];
    const hosted = new Verifier({
      keys: devKeys("booking_verifier"),
      airlines: [skyline],
      pageOrigins: ["http://localhost:3000", "https://capfare.example.app"],
      pageFetchOrigins: { "https://capfare.example.app": "http://localhost:3000" },
      fetchImpl: (async (u: string) => {
        seen.push(u);
        return new Response(fx("skyline-manage.html"), { status: 200 });
      }) as typeof fetch,
    });
    const r = await hosted.verifyPage("https://capfare.example.app/booker/manage?ref=X&t=abc", SALT);
    expect(r.attestation.attestation.method).toBe("tls_page");
    expect(seen[0]).toBe("http://localhost:3000/booker/manage?ref=X&t=abc");
  });
});
