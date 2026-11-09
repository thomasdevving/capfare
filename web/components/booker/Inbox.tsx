"use client";
import { useEffect, useState } from "react";

interface Mail { id: string; to: string; subject: string; date: number; ref: string }

export default function Inbox({ initial }: { initial: string }) {
  const [email, setEmail] = useState(initial);
  const [mails, setMails] = useState<Mail[] | null>(null);
  const load = (e: string) => fetch(`/api/booker/inbox?email=${encodeURIComponent(e)}`).then((r) => r.json()).then(setMails);
  useEffect(() => {
    if (initial) load(initial);
  }, [initial]);
  return (
    <div>
      <form className="sk-card sk-form" style={{ maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); load(email); }}>
        <h1 style={{ fontSize: 24 }}>Demo inbox</h1>
        <p style={{ color: "#5b6678", margin: 0 }}>Emails Skyline Travel “sent”. Each is a real, DKIM-signed .eml file you can upload to CapFare.</p>
        <label htmlFor="em">Email address</label>
        <input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="sk-btn" style={{ marginTop: 12 }}>Open inbox</button>
      </form>
      {mails ? (
        <table className="sk-mail" style={{ marginTop: 16 }}>
          <thead><tr><th>Subject</th><th>Received</th><th></th></tr></thead>
          <tbody>
            {mails.map((m) => (
              <tr key={m.id}>
                <td>{m.subject}</td>
                <td>{new Date(m.date * 1000).toLocaleString("en-GB")}</td>
                <td><a href={`/api/booker/email/${m.id}`} download>Download .eml</a></td>
              </tr>
            ))}
            {!mails.length ? <tr><td colSpan={3}>No emails for this address yet.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
