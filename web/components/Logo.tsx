/**
 * CapFare logo, redrawn as SVG from the supplied artwork: two slanted bars (the price
 * held below a cap) and a plane climbing past them. The wordmark is set in Outfit (closest
 * open font to the supplied lettering). Plane glyph adapted from Material Icons "flight" (Apache-2.0).
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size * 1.3} height={size} viewBox="0 0 104 80" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g fill="#FFD100" stroke="#FFD100" strokeWidth="9" strokeLinejoin="round">
        <path d="M9 74 L41 16 L60 16 L28 74 Z" />
        <path d="M45 74 L67 34 L86 34 L64 74 Z" />
      </g>
      <g transform="translate(70 -2) rotate(45 15 15) scale(1.25)" fill="#FFD100">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </g>
    </svg>
  );
}

export function Logo({ size = 28, inverse = true }: { size?: number; inverse?: boolean }) {
  return (
    <span className="logo" style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3 }}>
      <LogoMark size={size} />
      <span className="logo-word" style={{ fontSize: size * 1.05, color: inverse ? "#fff" : "#0b1024" }}>CapFare</span>
    </span>
  );
}
