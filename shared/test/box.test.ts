import { describe, expect, it } from "vitest";
import { boxKeyFromSeed, openJson, sealJson } from "../src/index.ts";

describe("sealed box", () => {
  it("roundtrips and only the enclave key opens it", async () => {
    const enclave = boxKeyFromSeed(new Uint8Array(32).fill(3));
    const other = boxKeyFromSeed(new Uint8Array(32).fill(4));
    const box = await sealJson({ booking_ref: "ABC123", last_name: "Jansen" }, enclave.publicKeyHex);
    expect(JSON.stringify(box)).not.toContain("ABC123");
    expect(await openJson(box, enclave.secretKey)).toEqual({ booking_ref: "ABC123", last_name: "Jansen" });
    await expect(openJson(box, other.secretKey)).rejects.toThrow();
  });
});
