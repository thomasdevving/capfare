import { describe, expect, it } from "vitest";
import { clientKey, CLIENT_HEADER } from "../src/rate-limit.ts";

const req = (remote: string, headers: Record<string, string> = {}) => ({ headers, socket: { remoteAddress: remote } });

describe("clientKey (per-visitor rate limits behind the web app)", () => {
  it("uses the visitor address the local web app hands over", () => {
    expect(clientKey(req("127.0.0.1", { [CLIENT_HEADER]: "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(req("::ffff:127.0.0.1", { [CLIENT_HEADER]: "203.0.113.8" }))).toBe("203.0.113.8");
  });
  it("ignores the header from anyone else, so a caller cannot pick its own key", () => {
    expect(clientKey(req("198.51.100.4", { [CLIENT_HEADER]: "1.2.3.4" }))).toBe("198.51.100.4");
    expect(clientKey(req("198.51.100.4", { "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.4");
  });
  it("falls back to the socket address without a header", () => {
    expect(clientKey(req("127.0.0.1"))).toBe("127.0.0.1");
  });
});
