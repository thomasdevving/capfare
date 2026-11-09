"use client";
/**
 * Booking proof: original .eml (DKIM-checked in the enclave) or booking reference + last
 * name (manage-booking check in the enclave). Both are sealed in the browser to the
 * booking_verifier's X25519 key; CapFare's web server only forwards ciphertext.
 */
import { useEffect, useState } from "react";
import { sealJson, type FlightKey, type Refundability, type SignedBookingAttestation } from "@capfare/shared";
import { errText, getJson, Msg, postJson } from "./ui";
import { passengerSalt, rememberedLastName } from "@/lib/wallet";
import { eur } from "@/lib/format";

interface Enclave {
  box_public_key: string;
  report: { kind: string };
  airlines: { code: string; name: string; status_check: string }[];
  live_check_origins?: string[];
}

export interface ProofResult {
  attestation: SignedBookingAttestation;
  flight_key: FlightKey;
}

const MAIL_HELP = [
  ["Gmail", "Open the email → ⋮ (More) → Download message. This saves the original .eml file."],
  ["Outlook.com", "Open the email → … → Save as. Choose the .eml format."],
  ["Apple Mail", "Select the email → File → Save As… → Format: Raw Message Source."],
  ["Thunderbird", "Open the email → … → Save As → File. Keep the .eml extension."],
];

export default function BookingProof({ flightKey, onVerified, demo, defaultPaid, liveOnly = false }: { flightKey?: FlightKey; onVerified: (r: ProofResult) => void; demo: boolean; defaultPaid?: number; liveOnly?: boolean }) {
  const [enclave, setEnclave] = useState<Enclave | null>(null);
  const [mode, setMode] = useState<"eml" | "link" | "status" | "demo">(liveOnly ? "link" : "eml");
  const [link, setLink] = useState("");
  const [demoLast, setDemoLast] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState("");
  const [last, setLast] = useState("");
  const [paid, setPaid] = useState(defaultPaid ? String(defaultPaid / 100) : "255");
  const [refundable, setRefundable] = useState<Refundability>("non_refundable");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJson<Enclave>("/api/verifier").then(setEnclave).catch((e) => setErr(`Booking checks are unavailable: ${errText(e)}`));
    setDemoLast(rememberedLastName());
  }, []);

  async function verifyEml(b64: string) {
    if (!enclave) throw new Error("verifier not loaded");
    const sealed = await sealJson({ eml_base64: b64, salt: await passengerSalt(), flight_key: flightKey }, enclave.box_public_key);
    return postJson<ProofResult>("/api/verify-eml", { sealed });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let r: ProofResult;
      if (mode === "eml") {
        if (!file) throw new Error("Choose the .eml file first");
        if (file.size > 2_000_000) throw new Error("That file is too large for a confirmation email");
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = "";
        for (const b of buf) bin += String.fromCharCode(b);
        r = await verifyEml(btoa(bin));
      } else if (mode === "link") {
        if (!enclave) throw new Error("verifier not loaded");
        const sealed = await sealJson({ url: link.trim(), salt: await passengerSalt(), flight_key: flightKey }, enclave.box_public_key);
        r = await postJson<ProofResult>("/api/verify-page", { sealed });
      } else if (mode === "status") {
        if (!enclave) throw new Error("verifier not loaded");
        const sealed = await sealJson({ airline: flightKey?.airline ?? "KL", booking_ref: ref.trim().toUpperCase(), last_name: last.trim(), salt: await passengerSalt(), flight_key: flightKey }, enclave.box_public_key);
        r = await postJson<ProofResult>("/api/verify-status", { sealed });
      } else {
        if (!flightKey) throw new Error("Enter the flight first");
        const cents = Math.round(Number(paid.replace(",", ".")) * 100);
        const fx = await postJson<{ eml_base64: string }>("/api/demo/fixture", {
          flight_key: flightKey,
          fare_label: flightKey.fare_class === "economy_light" ? "Economy Light" : flightKey.fare_class === "economy_standard" ? "Economy Standard" : "Economy Flex",
          paid_price_minor: cents,
          refundable,
          last_name: demoLast || "Tester",
        });
        r = await verifyEml(fx.eml_base64);
      }
      onVerified(r);
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" aria-labelledby="proof-title">
      <h3 id="proof-title">Your booking confirmation</h3>
      <div className="btn-row" role="tablist" aria-label="How to prove your booking">
        {!liveOnly ? (
          <button type="button" role="tab" aria-selected={mode === "eml"} className={`btn ${mode === "eml" ? "btn-primary" : ""}`} onClick={() => setMode("eml")}>Upload the email</button>
        ) : null}
        <button type="button" role="tab" aria-selected={mode === "link"} className={`btn ${mode === "link" ? "btn-primary" : ""}`} onClick={() => setMode("link")}>Booking page link</button>
        <button type="button" role="tab" aria-selected={mode === "status"} className={`btn ${mode === "status" ? "btn-primary" : ""}`} onClick={() => setMode("status")}>Booking code and last name</button>
        {demo && !liveOnly ? (
          <button type="button" role="tab" aria-selected={mode === "demo"} className={`btn ${mode === "demo" ? "btn-primary" : ""}`} onClick={() => setMode("demo")}>Demo confirmation</button>
        ) : null}
      </div>

      {mode === "eml" ? (
        <>
          <label htmlFor="eml">Original confirmation email (.eml)</label>
          <input id="eml" type="file" accept=".eml,message/rfc822" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="hint">Upload the original email, not a forward: forwarding changes the airline's signature. How to download it:</p>
          <dl className="small">
            {MAIL_HELP.map(([k, v]) => (
              <div key={k}>
                <dt style={{ fontWeight: 700 }}>{k}</dt>
                <dd style={{ margin: "0 0 6px" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {liveOnly ? (
        <p className="small muted">This is a refundable ticket, so we check the booking as it is now on the booking site. An email can&apos;t show a later cancellation.</p>
      ) : null}
      {mode === "link" ? (
        <>
          <label htmlFor="link">Link to your booking (the &quot;manage booking&quot; page)</label>
          <input id="link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/manage?…" autoComplete="off" />
          <p className="hint">
            With the CapFare extension, open your booking page and press <strong>Verify with CapFare</strong> instead. Our checker loads the page directly from the booking site and reads the booking as it is now.
            {enclave?.live_check_origins?.length ? ` Supported: ${enclave.live_check_origins.map((o) => new URL(o).host).join(", ")}.` : " No booking site supports this yet on this deployment."}
          </p>
        </>
      ) : null}
      {mode === "status" ? (
        <div className="grid2">
          <div>
            <label htmlFor="ref">Booking code</label>
            <input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" required />
          </div>
          <div>
            <label htmlFor="last">Last name</label>
            <input id="last" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" required />
          </div>
          <p className="hint" style={{ gridColumn: "1 / -1" }}>
            Live manage-booking checks are not available for {enclave?.airlines?.[0]?.name ?? "this airline"} yet{demo ? " (the demo airline works)" : ""}; upload the email instead.
          </p>
        </div>
      ) : null}
      {mode === "demo" ? (
        <div className="grid2">
          <div>
            <label htmlFor="paid">Price you paid (€)</label>
            <input id="paid" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dl">Lead passenger last name</label>
            <input id="dl" value={demoLast} onChange={(e) => setDemoLast(e.target.value)} autoComplete="family-name" />
          </div>
          <div>
            <label htmlFor="rf">Ticket type</label>
            <select id="rf" value={refundable} onChange={(e) => setRefundable(e.target.value as Refundability)}>
              <option value="non_refundable">Non-refundable</option>
              <option value="refundable">Refundable</option>
            </select>
          </div>
          <p className="hint" style={{ gridColumn: "1 / -1" }}>
            Creates a synthetic, signed test confirmation for {flightKey ? `${flightKey.flight_number} on ${flightKey.departure_date}` : "this flight"} at {eur(Math.round(Number(paid.replace(",", ".")) * 100) || 0)}. Demo deployments only.
          </p>
        </div>
      ) : null}

      <p className="small muted">
        Encrypted on this device to the booking checker&apos;s key{enclave?.report.kind === "dev" ? " (development key on this testnet deployment, not a hardware enclave)" : ""}. Only the flight, date, fare class and price come back.
      </p>
      {err ? <Msg kind="error">{err}</Msg> : null}
      <button className="btn btn-primary" disabled={busy || !enclave}>{busy ? "Checking…" : "Check my booking"}</button>
    </form>
  );
}
