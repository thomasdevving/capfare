import { ImageResponse } from "next/og";
import { HERO } from "@/lib/hero";

export const alt = "CapFare: lock the price of your flight, book wherever you want. Example fare chart with a €180 cap.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card generated from the hero chart (same example path and cap). */
export default function OG() {
  const W = 450, H = 280, PMIN = 15000, PMAX = 27500;
  const x = (i: number) => (i * W) / (HERO.path.length - 1);
  const y = (p: number) => ((PMAX - p) * H) / (PMAX - PMIN);
  const d = HERO.path.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p)}`).join(" ");
  const capY = y(18000);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 64, color: "#fff", background: "linear-gradient(180deg,#141636 0%,#29295f 45%,#4a3a7a 70%,#9a5a7c 86%,#df8f6a 100%)", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 520, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: "#FFD100", marginBottom: 28 }}>CapFare</div>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 800, lineHeight: 1.08 }}>Lock the price of your flight.</div>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 800, lineHeight: 1.08, marginTop: 8 }}>Book wherever you want.</div>
          <div style={{ display: "flex", fontSize: 24, marginTop: 26, color: "#e6e1ff" }}>Testnet prototype on NEAR</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 40, padding: 28, borderRadius: 24, background: "rgba(36,34,84,0.65)", border: "1px solid rgba(255,255,255,0.2)" }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, marginBottom: 14 }}>Example: KL1695 AMS → BCN</div>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <path d={`${d} L${W},${capY} L${x(5)},${capY} Z`} fill="rgba(255,209,0,0.45)" />
            <line x1="0" x2={W} y1={capY} y2={capY} stroke="#FFD100" strokeWidth="4" strokeDasharray="12 10" />
            <path d={d} fill="none" stroke="#d9cfff" strokeWidth="6" />
          </svg>
          <div style={{ display: "flex", fontSize: 30, marginTop: 14 }}>
            <span style={{ color: "#cfc9ee" }}>Cap €180, booked at €255:&nbsp;</span>
            <span style={{ color: "#FFD100", fontWeight: 800 }}>€70 back</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
