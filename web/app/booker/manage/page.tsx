import Link from "next/link";
import { BookerShell } from "@/components/booker/Shell";
import BookingFacts from "@/components/booker/BookingFacts";
import CancelButton from "@/components/booker/CancelButton";
import { getBooking, inbox } from "@/lib/booker/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — manage booking", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  const b = getBooking(q.ref ?? "", q.t ?? "");
  if (!b) return <BookerShell tab="trips"><div className="sk-wrap sk-section"><div className="sk-err">Booking not found. <Link href="/booker/trips">Look it up</Link></div></div></BookerShell>;
  const mail = inbox(b.email).find((m) => m.ref === b.ref && m.subject.startsWith("Booking confirmed"));
  return (
    <BookerShell tab="trips">
      <div className="sk-wrap sk-section">
        <section className="sk-card manage-booking">
          <h1 style={{ fontSize: 26 }}>Manage your booking</h1>
          <BookingFacts b={b} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {mail ? <a className="sk-btn ghost" href={`/api/booker/email/${mail.id}`}>Download confirmation email (.eml)</a> : null}
            {b.status === "confirmed" ? <CancelButton ref_={b.ref} token={b.token} refundable={b.fare.refundable} /> : null}
          </div>
        </section>
      </div>
    </BookerShell>
  );
}
