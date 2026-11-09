import { flightKeyHash, type SnapshotRecord } from "@capfare/shared";
import { viewClient } from "@/lib/chain";
import { serverConfig } from "@/lib/config";

/** The CapFare demo booking site: a stand-in for an airline/OTA website, used to test the extension. */
export const FLIGHT = { fn: "KL1695", date: "2027-06-14", from: "AMS", to: "BCN", dep: "07:20", arr: "09:40" };
export const FARES = [
  { id: "economy_light", name: "Economy Light", fallback: 17000, note: "Hand baggage only" },
  { id: "economy_standard", name: "Economy Standard", fallback: 22000, note: "1 checked bag" },
  { id: "economy_flex", name: "Economy Flex", fallback: 31500, note: "Changeable" },
];

export async function farePrices(): Promise<Record<string, { price: number; available: boolean }>> {
  const c = serverConfig();
  const out: Record<string, { price: number; available: boolean }> = {};
  await Promise.all(
    FARES.map(async (f) => {
      const h = flightKeyHash({ airline: "KL", flight_number: FLIGHT.fn, departure_date: FLIGHT.date, origin: FLIGHT.from, destination: FLIGHT.to, fare_class: f.id });
      try {
        const s = await viewClient().view<SnapshotRecord | null>(c.attestation, "get_latest_snapshot", { flight_key_hash: h });
        out[f.id] = s ? { price: s.price_minor, available: s.available } : { price: f.fallback, available: true };
      } catch {
        out[f.id] = { price: f.fallback, available: true };
      }
    }),
  );
  return out;
}

export const euro = (c: number) => `€ ${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export function DemoShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="demo-site">
      <div className="demo-banner" role="note">CapFare demo booking site. Not an airline: nothing here is a real booking. Used to test the CapFare extension.</div>
      <header className="demo-header">
        <a href="/demo-airline" className="demo-logo">Skyline Travel <small>(demo)</small></a>
        <nav><span>Flights</span><span>Hotels</span><span>My trips</span></nav>
      </header>
      <main className="demo-main">{children}</main>
      <style>{`
        .demo-site { font: 15px/1.5 Georgia, "Times New Roman", serif; background: #eef3f8; min-height: 100vh; color: #0b2340; }
        .demo-banner { background: #0b2340; color: #fff; font: 13px system-ui, sans-serif; padding: 6px 20px; }
        .demo-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #fff; border-bottom: 1px solid #cfdae6; }
        .demo-logo { font-size: 22px; font-weight: 700; color: #00529b; text-decoration: none; }
        .demo-logo small { font-size: 12px; color: #6a7f95; }
        .demo-header nav { display: flex; gap: 18px; font: 14px system-ui, sans-serif; color: #345; }
        .demo-main { max-width: 900px; margin: 0 auto; padding: 24px 20px 80px; }
        .demo-search { background: #fff; border-radius: 6px; padding: 14px 18px; margin-bottom: 18px; font: 14px system-ui, sans-serif; display: flex; gap: 24px; flex-wrap: wrap; }
        .flight-card, .booking-confirmed { background: #fff; border-radius: 6px; padding: 16px 18px; border: 1px solid #cfdae6; }
        .fl-top { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; font-family: system-ui, sans-serif; }
        .fl-number { font-weight: 700; } .fl-route { color: #345; }
        .fares { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 14px; }
        @media (max-width: 640px) { .fares { grid-template-columns: 1fr; } }
        .fare { border: 1px solid #cfdae6; border-radius: 6px; padding: 12px; font-family: system-ui, sans-serif; }
        .fare-name { font-weight: 600; } .fare-price { font-size: 22px; font-weight: 700; color: #00529b; display: block; margin: 4px 0; }
        .fare a { display: inline-block; margin-top: 8px; background: #00529b; color: #fff; padding: 6px 14px; border-radius: 4px; text-decoration: none; font-size: 14px; }
        .fare small { color: #6a7f95; } .sold { color: #a33; font-weight: 600; }
        .booking-confirmed h1 { font-size: 24px; margin: 0 0 8px; }
      `}</style>
    </div>
  );
}
