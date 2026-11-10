import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const SITE = "https://capfare.example";
const SKY = "https://skyline.example";
const req = (host: string, path: string) => new NextRequest(new URL(path, `https://${host}`), { headers: { host } });
const target = (r: Response) => ({ status: r.status, location: r.headers.get("location") });

describe("host routing for the demo booking site", () => {
  beforeEach(() => {
    process.env.SITE_URL = SITE;
    process.env.SKYLINE_URL = SKY;
  });
  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.SKYLINE_URL;
  });

  it("opens the booking site at the root of its own address", () => {
    expect(target(proxy(req("skyline.example", "/")))).toEqual({ status: 307, location: `${SKY}/booker` });
  });

  it("serves the booking site's pages, API and static files there", () => {
    for (const p of ["/booker", "/booker/results?from=AMS", "/api/booker/inbox?email=a@b.c", "/icon.svg", "/robots.txt"]) {
      expect(proxy(req("skyline.example", p)).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("sends CapFare pages on the booking-site address to CapFare", () => {
    expect(target(proxy(req("skyline.example", "/quote?fn=KL1695")))).toEqual({ status: 307, location: `${SITE}/quote?fn=KL1695` });
    expect(target(proxy(req("skyline.example", "/api/quote")))).toEqual({ status: 307, location: `${SITE}/api/quote` });
  });

  it("moves /booker on the CapFare address to the booking site, keeping the query", () => {
    expect(target(proxy(req("capfare.example", "/booker/manage?ref=AB12CD&t=x")))).toEqual({ status: 308, location: `${SKY}/booker/manage?ref=AB12CD&t=x` });
    expect(proxy(req("capfare.example", "/bookers")).headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves internal requests alone (the booking checker fetches over localhost)", () => {
    expect(proxy(req("localhost:3000", "/booker/manage?ref=AB12CD&t=x")).headers.get("x-middleware-next")).toBe("1");
  });

  it("does nothing without a booking-site address", () => {
    delete process.env.SKYLINE_URL;
    expect(proxy(req("capfare.example", "/booker")).headers.get("x-middleware-next")).toBe("1");
  });
});
