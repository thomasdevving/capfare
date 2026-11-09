import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { adapterFor, parseEuro } from "../src/adapters/index.ts";

const load = (f: string) => parseHTML(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")).document as unknown as Document;
const u = (p: string) => new URL(`http://localhost:3000${p}`);

describe("demo booking site adapter (saved HTML snapshots)", () => {
  it("extracts all fares from the search page", () => {
    const url = u("/demo-airline");
    const r = adapterFor(url)!.extract(load("search.html"), url)!;
    expect(r.kind).toBe("search");
    expect(r.flights.map((f) => f.fare_class)).toEqual(["economy_light", "economy_standard", "economy_flex"]);
    expect(r.flights[0]).toMatchObject({ flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", displayed_price_minor: 17000 });
  });
  it("extracts the selected fare on the details page", () => {
    const url = u("/demo-airline/flight?fare=economy_light");
    const r = adapterFor(url)!.extract(load("details.html"), url)!;
    expect(r.kind).toBe("details");
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0].fare_class).toBe("economy_light");
  });
  it("recognises the confirmation page and the booked price", () => {
    const url = u("/demo-airline/confirmation?fare=economy_standard");
    const r = adapterFor(url)!.extract(load("confirmation.html"), url)!;
    expect(r.kind).toBe("confirmation");
    expect(r.flights[0]).toMatchObject({ fare_class: "economy_standard", displayed_price_minor: 22000 });
  });
  it("ignores unsupported sites", () => {
    expect(adapterFor(new URL("https://www.example.com/flights"))).toBeUndefined();
  });
  it("parses euro formats", () => {
    expect(parseEuro("€ 1.234,50")).toBe(123450);
    expect(parseEuro("€170")).toBe(17000);
    expect(parseEuro("no price")).toBeUndefined();
  });
});

describe("manifest", () => {
  it("requests only the CapFare origin", async () => {
    const m = JSON.parse(readFileSync(new URL("../build/manifest.json", import.meta.url), "utf8"));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual([]);
    expect(m.host_permissions).toHaveLength(1);
    expect(JSON.stringify(m)).not.toContain("<all_urls>");
  });
});
