import "./booker.css";
import Link from "next/link";

export function BookerShell({ children, tab = "flights" }: { children: React.ReactNode; tab?: "flights" | "trips" | "inbox" }) {
  return (
    <div className="sk">
      <div className="sk-banner" role="note">
        Demo booking site for testing CapFare. Not a real travel agency: no real flights, payments or emails.
      </div>
      <header className="sk-top">
        <div className="in">
          <Link href="/booker" className="sk-logo">
            Skyline Travel <small>demo</small>
          </Link>
          <nav className="sk-nav" aria-label="Skyline Travel">
            <Link href="/booker" className={tab === "flights" ? "on" : ""}>Flights</Link>
            <Link href="/booker/trips" className={tab === "trips" ? "on" : ""}>My trips</Link>
            <Link href="/booker/inbox" className={tab === "inbox" ? "on" : ""}>Demo inbox</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="sk-wrap sk-foot">
        Skyline Travel is a fictitious demo site that ships with CapFare. Schedules and prices are generated for the demo; airline names are used only as examples.
      </footer>
    </div>
  );
}

export const eur = (c: number) => `€ ${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
export const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export function longDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
