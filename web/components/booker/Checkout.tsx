"use client";
import { useState } from "react";
import { eur } from "./Shell";

export interface CheckoutLeg {
  fn: string; from: string; to: string; date: string; fare: string; fareName: string; price: number; refundable: boolean; label: string;
}

export default function Checkout({ pax, legs }: { pax: number; legs: CheckoutLeg[] }) {
  const p = { pax };
  const perPerson = legs.reduce((a, l) => a + l.price, 0);
  const [out, ret] = legs;
  const [pass, setPass] = useState(Array.from({ length: p.pax }, () => ({ title: "Mr", first: "", last: "" })));
  const [email, setEmail] = useState("");
  const [card, setCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/booker/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fn: out.fn, from: out.from, to: out.to, date: out.date, fare: out.fare,
          ...(ret ? { ret: { fn: ret.fn, origin: ret.from, destination: ret.to, date: ret.date, fare: ret.fare } } : {}),
          passengers: pass, email, card,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      location.href = `/booker/confirmation?ref=${j.ref}&t=${j.token}`;
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      setBusy(false);
    }
  }

  return (
    <form className="sk-layout sk-form" onSubmit={pay} style={{ gridTemplateColumns: "1fr 320px" }}>
      <div>
        <section className="sk-card">
          <h2 style={{ fontSize: 19 }}>Who&apos;s flying?</h2>
          <p style={{ color: "#5b6678", margin: 0, fontSize: 14 }}>Enter names exactly as on the passport.</p>
          {pass.map((x, i) => (
            <fieldset key={i} style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
              <legend style={{ fontWeight: 700 }}>Passenger {i + 1}{i === 0 ? " (lead)" : ""}</legend>
              <div className="sk-grid3">
                <div>
                  <label htmlFor={`t${i}`}>Title</label>
                  <select id={`t${i}`} value={x.title} onChange={(e) => setPass(pass.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))}>
                    <option>Mr</option><option>Ms</option><option>Mx</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`f${i}`}>First name</label>
                  <input id={`f${i}`} value={x.first} onChange={(e) => setPass(pass.map((y, j) => (j === i ? { ...y, first: e.target.value } : y)))} required autoComplete={i === 0 ? "given-name" : "off"} />
                </div>
                <div>
                  <label htmlFor={`l${i}`}>Last name</label>
                  <input id={`l${i}`} value={x.last} onChange={(e) => setPass(pass.map((y, j) => (j === i ? { ...y, last: e.target.value } : y)))} required autoComplete={i === 0 ? "family-name" : "off"} />
                </div>
              </div>
            </fieldset>
          ))}
          <label htmlFor="email">Email for your e-ticket</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <p style={{ color: "#5b6678", fontSize: 13, margin: "6px 0 0" }}>Demo: emails go to the Skyline demo inbox, not to a real mailbox.</p>
        </section>
        <section className="sk-card" style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 19 }}>Payment</h2>
          <div className="sk-note" style={{ marginBottom: 8 }}>Demo payment: use any test number such as 4242 4242 4242 4242. Nothing is charged.</div>
          <div className="sk-grid2">
            <div>
              <label htmlFor="card">Card number</label>
              <input id="card" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value)} placeholder="4242 4242 4242 4242" required autoComplete="off" />
            </div>
            <div className="sk-grid2">
              <div><label htmlFor="exp">Expiry</label><input id="exp" placeholder="12/29" autoComplete="off" /></div>
              <div><label htmlFor="cvc">CVC</label><input id="cvc" placeholder="123" autoComplete="off" /></div>
            </div>
          </div>
        </section>
        {err ? <div className="sk-err" style={{ marginTop: 12 }} role="alert">{err}</div> : null}
      </div>
      <aside className="sk-card sk-summary">
        <h2 style={{ fontSize: 17 }}>Your trip</h2>
        {legs.map((l, i) => (
          <div key={l.fn}>
            {legs.length > 1 ? <h3 style={{ fontSize: 14, margin: "8px 0 2px" }}>{i === 0 ? "Outbound" : "Return"}</h3> : null}
            <p style={{ margin: "0 0 8px" }}>{l.label}</p>
            <dl className="sk-facts" style={{ gridTemplateColumns: "1fr auto" }}>
              <dt>Fare</dt><dd>{l.fareName}</dd>
              <dt>Ticket</dt><dd>{l.refundable ? "Refundable" : "Non-refundable"}</dd>
              <dt>{p.pax} × {eur(l.price)}</dt><dd>{eur(l.price * p.pax)}</dd>
            </dl>
          </div>
        ))}
        <button className="sk-btn" style={{ width: "100%" }} disabled={busy}>{busy ? "Booking…" : `Pay ${eur(perPerson * p.pax)}`}</button>
      </aside>
    </form>
  );
}
