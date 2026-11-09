/**
 * booking_verifier service. Inputs are sealed to the enclave's X25519 key by the client;
 * plaintext (emails, names, booking references) only exists inside this process.
 *   GET  /health
 *   GET  /v1/enclave                 signing + box public keys, measurement, report
 *   POST /v1/verify/eml              {sealed: box({eml_base64, flight_key?})}
 *   POST /v1/verify/status           {sealed: box({airline, booking_ref, last_name, flight_key?, booked_at?})}
 *   POST /v1/demo/fixture            (demo) {flight_key, fare_label, paid_price_minor, refundable, booked_at?, variant?}
 *   POST /v1/demo/booking-status     (demo) {booking_ref, status}
 */
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";
import { openJson, type FlightKey, type Refundability, type SealedBox } from "@capfare/shared";
import { HttpError, loadKeys, logger, RateLimiter, serve } from "@capfare/tee-common";
import { klm } from "./airlines/klm.ts";
import { DemoAirline, DemoKeys, demoResolver, makeFixtureEml } from "./demo-airline.ts";
import { Verifier, VerifyError } from "./verifier.ts";

const log = logger("booking_verifier");

export async function main() {
  const mode = process.env.CAPFARE_DEPLOYMENT ?? "dev";
  const demo = mode === "demo" || mode === "test";
  const keys = await loadKeys("booking_verifier");
  const demoKeys = demo ? new DemoKeys() : undefined;
  const demoAirline = demo ? new DemoAirline() : undefined;
  const realDns = (n: string, rr: string) => dns.resolve(n, rr as "TXT");
  const verifier = new Verifier({
    keys,
    airlines: [klm],
    resolver: demoKeys ? demoResolver(demoKeys, realDns) : realDns,
    statusCheckers: demoAirline ? { KL: (r, l) => demoAirline.checkStatus(r, l) } : undefined,
  });
  const limiter = new RateLimiter(10, 0.2);
  const guard = (req: { socket: { remoteAddress?: string } }) => {
    if (!limiter.take(req.socket.remoteAddress ?? "?")) throw new HttpError(429, "too many requests");
  };
  const wrap = async <T>(f: () => Promise<T>) => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof VerifyError) throw new HttpError(422, e.message);
      throw e;
    }
  };

  serve({
    port: Number(process.env.PORT ?? 8082),
    maxBodyBytes: 3 * 1024 * 1024,
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
    log,
    routes: {
      "GET /health": () => ({ ok: true, mode }),
      "GET /v1/enclave": () => ({
        service: "booking_verifier",
        signing_public_key: keys.signing.publicKeyHex,
        box_public_key: keys.box.publicKeyHex,
        measurement: keys.measurement,
        report: keys.report,
        airlines: [{ code: klm.code, name: klm.name, eml: true, status_check: demo ? "demo" : klm.statusAccess }],
      }),
      "POST /v1/verify/eml": (body: { sealed: SealedBox }, req) =>
        wrap(async () => {
          guard(req);
          const p = await openJson<{ eml_base64: string; flight_key?: FlightKey }>(body.sealed, keys.box.secretKey).catch(() => {
            throw new HttpError(400, "could not open sealed input");
          });
          const raw = Buffer.from(p.eml_base64, "base64").toString("utf8");
          return verifier.verifyEml(raw, p.flight_key);
        }),
      "POST /v1/verify/status": (body: { sealed: SealedBox }, req) =>
        wrap(async () => {
          guard(req);
          const p = await openJson<{ airline: string; booking_ref: string; last_name: string; flight_key?: FlightKey; booked_at?: number }>(
            body.sealed,
            keys.box.secretKey,
          ).catch(() => {
            throw new HttpError(400, "could not open sealed input");
          });
          return verifier.verifyStatus(p.airline, p.booking_ref, p.last_name, p.flight_key, p.booked_at);
        }),
      "POST /v1/demo/fixture": (body: { flight_key: FlightKey; fare_label: string; paid_price_minor: number; refundable: Refundability; booked_at?: number; variant?: "valid" | "forwarded" | "modified" | "wrong_domain" }) =>
        wrap(async () => {
          if (!demoKeys || !demoAirline) throw new HttpError(404, "not a demo deployment");
          const fk = body.flight_key;
          const f = await makeFixtureEml(
            {
              flight_number: fk.flight_number,
              departure_date: fk.departure_date,
              origin: fk.origin,
              destination: fk.destination,
              fare_label: body.fare_label,
              paid_price_minor: body.paid_price_minor,
              refundable: body.refundable,
              booked_at: new Date((body.booked_at ?? Math.floor(Date.now() / 1000)) * 1000),
              subject_prefix: body.variant === "forwarded" ? "Fwd: " : undefined,
            },
            demoKeys,
            body.variant === "wrong_domain" ? "klm-deals.example" : "klm.com",
          );
          let eml = f.eml;
          if (body.variant === "modified") eml = eml.replace(/Total price: EUR [0-9.]+/, "Total price: EUR 999.00");
          if (body.variant === "wrong_domain") eml = eml.replace(/noreply@klm-deals\.example/, "noreply@klm.com");
          const text = eml.split(/\r?\n\r?\n/).slice(1).join("\r\n\r\n");
          demoAirline.register(f.booking_ref, f.last_name, text);
          // Demo only: the fixture's booking reference is returned so the demo can run a
          // status check. Real deployments never return booking references.
          return { eml_base64: Buffer.from(eml).toString("base64"), booking_ref: f.booking_ref, last_name: f.last_name, synthetic: true };
        }),
      "POST /v1/demo/booking-status": (body: { booking_ref: string; status: "active" | "cancelled" }) => {
        if (!demoAirline) throw new HttpError(404, "not a demo deployment");
        demoAirline.setStatus(body.booking_ref, body.status);
        return { ok: true };
      },
    },
  });
  log("started", { mode, signing_public_key: keys.signing.publicKeyHex, box_public_key: keys.box.publicKeyHex, measurement: keys.measurement });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
