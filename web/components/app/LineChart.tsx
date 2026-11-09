/** Minimal accessible SVG line chart (no external chart library). */
export default function LineChart({ points, label, format }: { points: { x: string; y: number }[]; label: string; format: (v: number) => string }) {
  if (points.length < 2) return <p className="muted small">Not enough history yet ({points.length} epoch{points.length === 1 ? "" : "s"}).</p>;
  const W = 600, H = 200, L = 64, R = 16, T = 12, B = 28;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.y)}`).join(" ");
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ${format(points[0].y)} to ${format(points[points.length - 1].y)} over ${points.length} epochs`}>
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text className="axis num" x={L - 6} y={y(v) + 4} textAnchor="end">{format(v)}</text>
          </g>
        ))}
        <path d={d} className="price-line" />
        <text className="axis" x={L} y={H - 8}>{points[0].x}</text>
        <text className="axis" x={W - R} y={H - 8} textAnchor="end">{points[points.length - 1].x}</text>
      </svg>
    </figure>
  );
}
