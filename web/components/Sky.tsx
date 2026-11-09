/** Dusk sky above the clouds, drawn in SVG (no stock photo). Decorative only. */
export default function Sky() {
  return (
    <svg className="sky-fixed" viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sky-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#141636" />
          <stop offset="0.45" stopColor="#29295f" />
          <stop offset="0.7" stopColor="#4a3a7a" />
          <stop offset="0.84" stopColor="#9a5a7c" />
          <stop offset="0.93" stopColor="#df8f6a" />
          <stop offset="1" stopColor="#f2bd84" />
        </linearGradient>
        <radialGradient id="sun-g" cx="0.88" cy="0.86" r="0.3">
          <stop offset="0" stopColor="#fff1c9" stopOpacity="0.95" />
          <stop offset="0.12" stopColor="#ffc777" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff9a5c" stopOpacity="0" />
        </radialGradient>
        <filter id="soft" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="softer" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="34" />
        </filter>
      </defs>
      <rect width="1440" height="820" fill="url(#sky-g)" />
      <rect width="1440" height="820" fill="url(#sun-g)" />
      {/* cloud layers: far (warm), mid (rose), near (violet shadow) */}
      <g filter="url(#softer)" opacity="0.75">
        <ellipse cx="300" cy="640" rx="520" ry="46" fill="#f4b58c" />
        <ellipse cx="1050" cy="620" rx="560" ry="40" fill="#f7c79a" />
      </g>
      <g filter="url(#soft)" opacity="0.85">
        <ellipse cx="160" cy="720" rx="380" ry="60" fill="#c77d8f" />
        <ellipse cx="720" cy="700" rx="420" ry="52" fill="#d48e8e" />
        <ellipse cx="1260" cy="730" rx="360" ry="64" fill="#c27a8c" />
      </g>
      <g filter="url(#soft)" opacity="0.9">
        <ellipse cx="420" cy="810" rx="520" ry="80" fill="#6b4a83" />
        <ellipse cx="1120" cy="820" rx="560" ry="90" fill="#5d4380" />
      </g>
    </svg>
  );
}
