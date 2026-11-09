import { BookerShell } from "@/components/booker/Shell";
import Trips from "@/components/booker/Trips";
export const metadata = { title: "Skyline Travel (demo) — my trips", robots: { index: false } };
export default function Page() {
  return (
    <BookerShell tab="trips">
      <div className="sk-wrap sk-section"><Trips /></div>
    </BookerShell>
  );
}
