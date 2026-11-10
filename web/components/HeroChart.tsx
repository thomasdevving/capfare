"use client";
/**
 * The hero fare chart: one orchestrated animation (price line draws past the cap, the
 * payout area fills, the payout figure appears), a draggable + keyboard-operable cap line,
 * and live premium/payout from the public formula with contract parameters.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Params } from "@capfare/shared";
import { dict, type Locale } from "@/lib/i18n";
import { clampCap, EXAMPLE_VAULT, HERO, heroQuote, type VaultFiguresLite } from "@/lib/hero";
import { duration, eur } from "@/lib/format";
import exampleParams from "@/lib/example-params.json";

const PMIN = 15_000, PMAX = 27_500;
const T = 20, B = 34;
function geometry(compact: boolean) {
  const W = compact ? 400 : 640, H = compact ? 250 : 290, L = compact ? 44 : 52, R = compact ? 76 : 92;
  return {
    W, H, L, R,
    x: (i: number) => L + (i * (W - L - R)) / (HERO.path.length - 1),
    y: (p: number) => T + ((PMAX - p) * (H - T - B)) / (PMAX - PMIN),
    priceAtY: (py: number) => PMAX - ((py - T) * (PMAX - PMIN)) / (H - T - B),
  };
}

interface ParamsState {
  params: Params;
  vault: VaultFiguresLite;
  live: boolean;
  network: string;
}

export default function HeroChart({ locale }: { locale: Locale }) {
  const t = dict(locale).chart;
  const [state, setState] = useState<ParamsState>({ params: exampleParams as unknown as Params, vault: EXAMPLE_VAULT, live: false, network: "" });
  const [loaded, setLoaded] = useState(false);
  const [cap, setCap] = useState(HERO.defaultCap);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 600px)");
    const f = () => setCompact(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const { W, H, L, R, x, y, priceAtY } = geometry(compact);

  useEffect(() => {
    let alive = true;
    fetch("/api/params")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { params: Params; vault: VaultFiguresLite; network: string }) => {
        if (alive) setState({ params: j.params, vault: j.vault ?? EXAMPLE_VAULT, live: true, network: j.network });
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const q = useMemo(() => {
    try {
      return heroQuote(state.params, cap, state.vault);
    } catch {
      return heroQuote(exampleParams as unknown as Params, cap);
    }
  }, [state, cap]);

  const linePath = HERO.path.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");

  // Area where the price is above the cap (piecewise, with interpolated crossings).
  const area = useMemo(() => {
    const pts: string[] = [];
    const segs: string[] = [];
    const flush = () => {
      if (pts.length) segs.push(`M${pts.join(" L")} Z`);
      pts.length = 0;
    };
    for (let i = 0; i < HERO.path.length; i++) {
      const p = HERO.path[i];
      const prev = HERO.path[i - 1];
      if (i > 0 && (prev - cap) * (p - cap) < 0) {
        const f = (cap - prev) / (p - prev);
        const xc = x(i - 1) + f * (x(i) - x(i - 1));
        if (p > cap) pts.push(`${xc.toFixed(1)},${y(cap).toFixed(1)}`);
        else {
          pts.push(`${xc.toFixed(1)},${y(cap).toFixed(1)}`);
          flush();
        }
      }
      if (p > cap) {
        if (!pts.length) pts.push(`${x(i).toFixed(1)},${y(cap).toFixed(1)}`);
        pts.push(`${x(i).toFixed(1)},${y(p).toFixed(1)}`);
      }
    }
    if (pts.length) pts.push(`${x(HERO.path.length - 1).toFixed(1)},${y(cap).toFixed(1)}`);
    flush();
    return segs.join(" ");
  }, [cap, compact]);

  const setFromClientY = useCallback((clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const py = ((clientY - r.top) / r.height) * H;
    setCap(clampCap(priceAtY(py)));
  }, [H, priceAtY]);

  const onPointerDown = (e: PointerEvent<SVGRectElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    setFromClientY(e.clientY);
  };
  const onPointerMove = (e: PointerEvent<SVGRectElement>) => dragging && setFromClientY(e.clientY);
  const onPointerUp = () => setDragging(false);

  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    const step = { ArrowUp: 100, ArrowRight: 100, ArrowDown: -100, ArrowLeft: -100, PageUp: 1000, PageDown: -1000 }[e.key];
    if (step) {
      e.preventDefault();
      setCap((c) => clampCap(c + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      setCap(HERO.minCap);
    } else if (e.key === "End") {
      e.preventDefault();
      setCap(HERO.maxCap);
    }
  };

  const yTicks = [16_000, 20_000, 24_000];
  const last = HERO.path.length - 1;
  const gross = Math.max(0, Math.min(HERO.path[last], HERO.paid) - cap);

  return (
    <figure className="figure chart" aria-labelledby="hero-caption">
      <div className="card-head">
        <div>
          <div className="route">KL1695 AMS → BCN</div>
          <div className="meta">{t.cardMeta}</div>
        </div>
        <span className="chip">{t.exampleChip}</span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t.alt(cap, q.payout, q.premium)}>
        <defs>
          <linearGradient id="payout-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd100" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffd100" stopOpacity="0.28" />
          </linearGradient>
        </defs>
        {yTicks.map((p) => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke="var(--line)" strokeWidth="1" />
            <text className="axis num" x={L - 8} y={y(p) + 4} textAnchor="end">
              {eur(p)}
            </text>
          </g>
        ))}
        {(compact ? [0, last] : [0, 7, last]).map((i) => (
          <text key={i} className={`axis num ${i === 7 ? "axis-mid" : ""}`} x={x(i)} y={H - 16} textAnchor={i === last ? "end" : i === 0 ? "start" : "middle"}>
            {i === last ? t.booked : `−${last - i} ${t.daysBefore}`}
          </text>
        ))}

        <g className="reveal-area">
          <path className="payout-area" d={area} />
          {gross > 0 ? (
            <rect className="payout-area payout-bar" x={x(last) - 7} width="14" y={y(Math.min(HERO.path[last], HERO.paid))} height={y(cap) - y(Math.min(HERO.path[last], HERO.paid))} />
          ) : null}
        </g>

        <path className="price-line draw" d={linePath} pathLength={1} />
        <circle className="booked-dot reveal-area" cx={x(last)} cy={y(HERO.paid)} r="5" />
        <g className="reveal-label">
          <rect className="end-pill" x={W - R + 6} y={y(HERO.path[last]) - 14} width="62" height="28" rx="14" />
          <text className="end-pill-text num" x={W - R + 37} y={y(HERO.path[last]) + 5} textAnchor="middle">
            {eur(HERO.path[last])}
          </text>
        </g>

        <g
          className="cap-group"
          tabIndex={0}
          role="slider"
          aria-label={t.sliderLabel}
          aria-valuemin={HERO.minCap / 100}
          aria-valuemax={HERO.maxCap / 100}
          aria-valuenow={cap / 100}
          aria-valuetext={`${eur(cap)}. ${t.youGetBack} ${eur(q.payout)}. ${t.premium} ${eur(q.premium)}.`}
          onKeyDown={onKey}
        >
          <line className="cap-line" x1={L} x2={W - R} y1={y(cap)} y2={y(cap)} />
          <circle className="cap-handle" cx={W - R} cy={y(cap)} r="7" />
          <rect className="cap-pill" x={L + 70} y={y(cap) - 34} width="132" height="26" rx="13" />
          <text className="cap-pill-text num" x={L + 136} y={y(cap) - 16} textAnchor="middle">
            {t.yourCap}: {eur(cap)}
          </text>
          <rect className="cap-hit" x={L} width={W - L - R + 20} y={y(cap) - 36} height="58" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        </g>
      </svg>

      <dl className="readout" aria-live="polite">
        <div className="payout reveal-figure">
          <dt>{t.youGetBack}</dt>
          <dd>{eur(q.payout)}</dd>
        </div>
        <div>
          <dt>{t.premium}</dt>
          <dd>{eur(q.premium)}</dd>
        </div>
        <div>
          <dt>{t.deductible}</dt>
          <dd>{eur(q.deductible)}</dd>
        </div>
        <div>
          <dt>{t.maxPayout}</dt>
          <dd>{eur(q.maxPayout)}</dd>
        </div>
      </dl>
      <p className="params-note">
        {t.activeAfter} {duration(q.activationDelaySecs)}. {t.dragHint}{" "}
        {loaded ? (state.live ? t.liveParams(state.network) : t.exampleParams) : null}
      </p>
      <figcaption id="hero-caption">{t.caption}</figcaption>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .chart .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: cf-draw 1.6s cubic-bezier(.35,0,.25,1) .2s forwards; }
          .chart .reveal-area { opacity: 0; animation: cf-fade .5s ease-out 1.75s forwards; }
          .chart .reveal-label { opacity: 0; animation: cf-fade .3s ease-out 1.7s forwards; }
          .reveal-figure dd { opacity: 0; transform: translateY(4px); animation: cf-rise .4s ease-out 2.2s forwards; }
        }
        @keyframes cf-draw { to { stroke-dashoffset: 0; } }
        @keyframes cf-fade { to { opacity: 1; } }
        @keyframes cf-rise { to { opacity: 1; transform: none; } }
      `}</style>
    </figure>
  );
}
