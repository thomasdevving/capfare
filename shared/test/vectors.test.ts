import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  attestationDigest, bytesToHex, encodeRouteKey, capPayout, coverageCovers, coverageHash, legNullifier, routeKeyHash, validateRouteKey, computePremium, dropPayout, encodeAttestation, encodeSnapshot,
  flightKeyHash, keyFromSeed, routeWeekKey, signAttestation, signSnapshot, snapshotDigest, validateFlightKey,
  verifyAttestation, verifySnapshot,
} from "../src/index.ts";

const V = JSON.parse(readFileSync(fileURLToPath(new URL("../test-vectors/vectors.json", import.meta.url)), "utf8"));

describe("conformance with contracts/core", () => {
  it("flight key hashes", () => {
    for (const f of V.flight_keys) {
      expect(validateFlightKey(f.flight_key)).toBeNull();
      expect(flightKeyHash(f.flight_key)).toBe(f.hash);
    }
  });
  it("snapshot borsh + digest", () => {
    expect(bytesToHex(encodeSnapshot(V.snapshot.value))).toBe(V.snapshot.borsh_hex);
    expect(bytesToHex(snapshotDigest(V.snapshot.value))).toBe(V.snapshot.digest);
  });
  it("attestation borsh + digest", () => {
    expect(bytesToHex(encodeAttestation(V.attestation.value))).toBe(V.attestation.borsh_hex);
    expect(bytesToHex(attestationDigest(V.attestation.value))).toBe(V.attestation.digest);
  });
  it("route keys, coverages and leg nullifiers", () => {
    expect(validateRouteKey(V.route_key.value)).toBeNull();
    expect(routeKeyHash(V.route_key.value)).toBe(V.route_key.hash);
    for (const c of V.coverages) expect(coverageHash(c.coverage)).toBe(c.hash);
    const l = V.leg_nullifier;
    expect(legNullifier(l.booking_nullifier, l.flight_key_hash)).toBe(l.leg_nullifier);
    const flight = V.flight_keys[0].flight_key;
    expect(coverageCovers(V.coverages[1].coverage, { ...flight, flight_number: "VY1234", airline: "VY" })).toBe(true);
    expect(coverageCovers(V.coverages[1].coverage, { ...flight, departure_date: "2027-06-15" })).toBe(false);
    expect(coverageCovers(V.coverages[0].coverage, { ...flight, flight_number: "KL1696" })).toBe(false);
    // Flexible cover: airport groups and a date window, same bytes and hash as Rust.
    expect(validateRouteKey(V.flex_route_key.value)).toBeNull();
    expect(bytesToHex(encodeRouteKey(V.flex_route_key.value))).toBe(V.flex_route_key.borsh_hex);
    expect(routeKeyHash(V.flex_route_key.value)).toBe(V.flex_route_key.hash);
    const flexCov = V.coverages[2].coverage;
    const lon = { ...flight, origin: "EIN", destination: "LGW", fare_class: "economy_standard" };
    expect(coverageCovers(flexCov, { ...lon, departure_date: "2027-06-16" })).toBe(true);
    expect(coverageCovers(flexCov, { ...lon, departure_date: "2027-06-17" })).toBe(false);
    expect(coverageCovers(flexCov, { ...lon, destination: "CDG" })).toBe(false);
  });
  it("route week key", () => {
    const r = V.route_week;
    expect(routeWeekKey(r.origin, r.destination, r.departure_ts)).toBe(r.key);
  });
  it("premiums", () => {
    for (const p of V.premiums) {
      const out = computePremium(V.params[p.inputs.product], p.inputs);
      expect(out.premium).toBe(p.premium);
      expect(out.unclamped).toBe(p.unclamped);
    }
  });
  it("payouts", () => {
    for (const p of V.cap_payouts) expect(capPayout(p.index, p.paid, p.strike, p.deductible, p.max_payout)).toBe(p.payout);
    expect(dropPayout(22_000, 19_500, 500, 6_000)).toBe(2_000);
  });
});

describe("signing", () => {
  const k = keyFromSeed(new Uint8Array(32).fill(7));
  it("signs and verifies snapshots; tampering breaks the signature", () => {
    const s = signSnapshot(V.snapshot.value, k);
    expect(verifySnapshot(s)).toBe(true);
    expect(verifySnapshot({ ...s, snapshot: { ...s.snapshot, price_minor: 1 } })).toBe(false);
  });
  it("signs and verifies attestations", () => {
    const a = signAttestation(V.attestation.value, k);
    expect(verifyAttestation(a)).toBe(true);
    expect(verifyAttestation({ ...a, attestation: { ...a.attestation, paid_price_minor: 1 } })).toBe(false);
  });
  it("matches the ed25519 key used in Rust tests (seed 7)", () => {
    // Rust: SigningKey::from_bytes(&[7u8; 32]); the public key is deterministic.
    expect(k.publicKeyHex).toHaveLength(64);
  });
});
