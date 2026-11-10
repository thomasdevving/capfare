import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { adapterFor, parseEuro } from "../src/adapters/index.ts";

const load = (f: string) => parseHTML(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")).document as unknown as Document;
const u = (p: string) => new URL(`http://localhost:3000${p}`);

describe("Skyline Travel (demo) adapter, saved HTML snapshots", () => {
  it("search results: every flight with its Economy Light price", () => {
    const url = u("/booker/results?from=AMS&to=BCN&date=2027-06-14&pax=1");
    const r = adapterFor(url)!.extract(load("search.html"), url)!;
    expect(r.kind).toBe("search");
    expect(r.flights.length).toBeGreaterThanOrEqual(5);
    const kl = r.flights.find((f) => f.flight_number === "KL1695")!;
    expect(kl).toMatchObject({ departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" });
    expect(kl.displayed_price_minor).toBeGreaterThan(0);
  });
  it("fare page: three fares", () => {
    const url = u("/booker/flight?fn=KL1695");
    const r = adapterFor(url)!.extract(load("details.html"), url)!;
    expect(r.kind).toBe("details");
    expect(r.flights.map((f) => f.fare_class)).toEqual(["economy_light", "economy_standard", "economy_flex"]);
  });
  it("confirmation page: booked fare and price", () => {
    const url = u("/booker/confirmation");
    const r = adapterFor(url)!.extract(load("confirmation.html"), url)!;
    expect(r.kind).toBe("confirmation");
    expect(r.flights[0]).toMatchObject({ flight_number: "KL1695", fare_class: "economy_standard" });
    expect(r.flights[0].displayed_price_minor).toBeGreaterThan(0);
  });
  it("travellers: from the search and from the booking", () => {
    const url = u("/booker/results?from=AMS&to=BCN&date=2027-06-14&pax=3");
    expect(adapterFor(url)!.extract(load("search.html"), url)!.travellers).toBe(3);
    const conf = u("/booker/confirmation");
    expect(adapterFor(conf)!.extract(load("confirmation.html"), conf)!.travellers).toBe(1);
  });
  it("manage page is recognised (offers the live check)", () => {
    const url = u("/booker/manage");
    expect(adapterFor(url)!.extract(load("manage.html"), url)!.kind).toBe("manage");
  });
  it("other sites have no site adapter (the generic reader takes them)", () => {
    expect(adapterFor(new URL("https://www.example.com/flights"))).toBeUndefined();
  });
  it("parses euro formats", () => {
    expect(parseEuro("€ 1.234,50")).toBe(123450);
    expect(parseEuro("€170")).toBe(17000);
    expect(parseEuro("no price")).toBeUndefined();
  });
});

describe("manifest", () => {
  it("requires only the CapFare origin; other sites on click (activeTab) or after opt-in (optional)", () => {
    const m = JSON.parse(readFileSync(new URL("../build/manifest.json", import.meta.url), "utf8"));
    expect(m.manifest_version).toBe(3);
    // None of these show an install warning; reading other sites is asked for when switched on.
    expect(m.permissions.sort()).toEqual(["activeTab", "scripting", "storage"]);
    expect(m.host_permissions).toHaveLength(1);
    expect(m.optional_host_permissions).toEqual(["https://*/*"]);
    expect(m.content_scripts).toHaveLength(1);
    expect(m.content_scripts[0].matches[0]).toMatch(/\/booker\*$/);
    expect(JSON.stringify(m)).not.toContain("<all_urls>");
  });
});
