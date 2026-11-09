"use client";
import { useEffect, useState } from "react";
import { createAccount, passkeySupported, signOut } from "@/lib/wallet";
import { errText, Msg, useSession } from "./ui";

export default function AccountClient() {
  const s = useSession();
  const [name, setName] = useState("");
  const [pk, setPk] = useState<boolean | null>(null);
  const [usePk, setUsePk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    passkeySupported().then((ok) => {
      setPk(ok);
      setUsePk(ok);
    });
  }, []);

  if (s === undefined) return null;
  if (s)
    return (
      <div className="card">
        <p>
          Signed in as <strong className="mono-wrap">{s.accountId}</strong>
        </p>
        <p className="small muted">
          {s.mode === "passkey"
            ? "Your key is derived from your passkey each time you confirm. It is never stored."
            : "Testnet device key stored in this browser. Do not use this mode with real money."}
        </p>
        <div className="btn-row">
          <a className="btn btn-primary" href="/quote">Check a flight</a>
          <button className="btn" onClick={() => signOut()}>Sign out on this device</button>
        </div>
      </div>
    );

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await createAccount(name.trim().toLowerCase(), usePk);
        } catch (x) {
          setErr(errText(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="name">Choose an account name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9][a-z0-9_\-]{1,30}[a-z0-9]" required autoComplete="username" aria-describedby="name-hint" />
      <p className="hint" id="name-hint">3–32 lowercase letters or digits. It becomes a readable NEAR account name; no email needed.</p>
      <fieldset style={{ border: 0, padding: 0, margin: "12px 0" }}>
        <legend className="small muted">How to protect it</legend>
        <label style={{ fontWeight: 400 }}>
          <input type="radio" name="mode" checked={usePk} disabled={pk === false} onChange={() => setUsePk(true)} style={{ width: "auto", minHeight: 0 }} /> Passkey (Face ID, fingerprint, security key)
          {pk === false ? <span className="small muted"> — not supported by this browser</span> : null}
        </label>
        <label style={{ fontWeight: 400 }}>
          <input type="radio" name="mode" checked={!usePk} onChange={() => setUsePk(false)} style={{ width: "auto", minHeight: 0 }} /> Device key in this browser (testnet only)
        </label>
      </fieldset>
      {err ? <Msg kind="error">{err}</Msg> : null}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      <p className="small muted" style={{ marginTop: 12 }}>
        You never pay network fees: the CapFare relayer pays them. Your account can only spend what you put in it.
      </p>
    </form>
  );
}
