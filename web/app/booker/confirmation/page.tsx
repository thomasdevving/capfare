import Link from "next/link";
import { BookerShell } from "@/components/booker/Shell";
import BookingFacts from "@/components/booker/BookingFacts";
import { getBooking } from "@/lib/booker/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — booked", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  const b = getBooking(q.ref ?? "", q.t ?? "");
  if (!b) return <BookerShell><div className="sk-wrap sk-section"><div className="sk-err">Booking not found.</div></div></BookerShell>;
  return (
    <BookerShell>
      <div className="sk-wrap sk-section">
        <section className="sk-card booking-confirmed">
          <h1 style={{ fontSize: 26 }}>Your flight is booked</h1>
          <p>We sent your e-ticket to <strong>{b.email}</strong>. <Link href={`/booker/inbox?email=${encodeURIComponent(b.email)}`}>Open the demo inbox</Link></p>
          <BookingFacts b={b} />
          <a className="sk-btn ghost" href={`/booker/manage?ref=${b.ref}&t=${b.token}`}>Manage booking</a>
        </section>
      </div>
    </BookerShell>
  );
}
