/**
 * CapFare demo film. Every frame is a pure function of t: window.renderFrame(t).
 *
 * Structure: each beat of timeline.js is a full-frame layer (.beat) built by a builder below that
 * returns render(lt) for local time lt (seconds since the beat starts; may be slightly negative
 * or past the end while a transition overlaps). Transitions between beats are a two-band
 * diagonal wipe or a circle iris. Real app footage (video/footage/<take>/) plays inside a clean
 * browser frame with eased crops; idle waits recorded during blockchain finality are cut out
 * with a short dissolve.
 *
 * Exposes: DURATION, renderFrame(t), ready, CUES (sound effects), VO (caption timing),
 * camAt(t) (webcam placeholder rect), BEATS (start times).
 */
(() => {
  const QS = new URLSearchParams(location.search);
  const CUT = QS.get("cut") || "full";
  let { beats, duration } = TIMELINE.cut(CUT);
  // The X cut follows Thomas's recorded voice (video/voice/plan.py -> xvoice.js): scene lengths,
  // caption lines with word timing, and where the webcam shows.
  const XV = CUT === "x" && window.XVOICE ? window.XVOICE : null;
  if (XV) {
    const byId = Object.fromEntries(beats.map((b) => [b.id, b]));
    beats = XV.beats.map((v) => ({ ...byId[v.id], start: v.start, dur: v.dur, voice: v.voice, xcaps: v.captions, xwords: v.words, cam: v.cam ? { ...v.cam, src: v.voice.src, voiceIn: v.voice.in, voiceOut: v.voice.out, voiceAt: v.voice.at } : null }));
    duration = XV.duration;
  }
  const capsOf = (b) => b.xcaps ?? TIMELINE.captions(b);
  const W = 1920, H = 1080;
  const HOST = "capfare-production.up.railway.app";
  const HOSTS = { app: HOST, skyline: "skyline-travel-demo.up.railway.app" };
  const C = { navy: "#0b2447", ink: "#0b1024", yellow: "#FFD100", onYellow: "#14132e", blue: "#0f5fc2", link: "#173f73", light: "#f2f6fb", light2: "#e3edfc", line: "#dfe7f0", lav: "#d9cfff", green: "#246c42", muted: "#50627a" };
  const TS = 1;      // pace factor for entrances (1 = as designed)
  const TR = 1.15;   // transition length (s)
  const XF = 0.45;   // crossfade between footage shots (s)
  const DIS = 0.35;  // dissolve over a cut-out wait (s)

  // ---------- easing ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const out3 = (t) => 1 - Math.pow(1 - t, 3);
  const in3 = (t) => t * t * t;
  const sine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const back = (t) => { const c1 = 1.3, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const elastic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const win = (t, a, b, fi = 0.4, fo = 0.4) => Math.min(seg(t, a, a + fi), 1 - seg(t, b - fo, b));
  const S = (t) => t * TS; // scaled entrance time

  // ---------- DOM helpers ----------
  const stage = document.getElementById("stage");
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || stage).appendChild(e);
    return e;
  }
  function at(e, x, y, w, h) {
    e.style.left = x + "px";
    e.style.top = y + "px";
    if (w != null) e.style.width = w + "px";
    if (h != null) e.style.height = h + "px";
    return e;
  }
  function sv(tag, parent, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  }
  function svgBox(parent, x, y, w, h) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("width", w);
    s.setAttribute("height", h);
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.style.position = "absolute";
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.overflow = "visible";
    parent.appendChild(s);
    return s;
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function T(e, s) { if (e.__t !== s) { e.style.transform = s; e.__t = s; } }
  function O(e, o) { o = r3(clamp(o)); if (e.__o !== o) { e.style.opacity = o; e.__o = o; } }
  function V(e, v) { const s = v ? "visible" : "hidden"; if (e.__v !== s) { e.style.visibility = s; e.__v = s; } }
  function A(e, k, v) { if (e["__" + k] !== v) { e.setAttribute(k, v); e["__" + k] = v; } }
  /** Fade + rise entrance at local time a (seconds), over d. */
  function rise(e, lt, a, d = 0.7, dy = 26) {
    const p = out3(seg(lt, S(a), S(a) + d));
    O(e, p);
    T(e, `translateY(${r3((1 - p) * dy)}px)`);
    return p;
  }
  function pop(e, lt, a, d = 0.55) {
    const p = seg(lt, S(a), S(a) + d);
    O(e, Math.min(1, p * 2.2));
    T(e, `scale(${r3(0.4 + 0.6 * back(p))})`);
    return p;
  }
  const eur = (c, d = 0) => "€" + (c / 100).toFixed(d);

  // ---------- sound cues (collected once, while building) ----------
  const CUES = [];
  function cue(t, kind, gain = 1) {
    if (t >= 0 && t <= duration) CUES.push({ t: r3(t), kind, gain });
  }
  /** Cue at design time lt of a beat (graphics are designed for the full cut, see beat.k). */
  const cueB = (beat, lt, kind, gain = 1) => cue(beat.start + lt / (beat.k ?? 1), kind, gain);
  /** When a word of the voice-over is spoken (captions spread words evenly). */
  function wordTime(beat, re) {
    if (beat.xwords) {
      const w = beat.xwords.find((x) => re.test(x.w) || re.test(x.w.replace(/[.,?!:;]+$/, "")));
      return w ? w.t : null;
    }
    for (const c of TIMELINE.captions(beat)) {
      const ws = c.text.split(" ");
      const i = ws.findIndex((w) => re.test(w));
      if (i >= 0) return c.start + ((c.end - c.start) * i) / ws.length;
    }
    return null;
  }

  // ---------- footage ----------
  const FOOT = {};
  async function loadTake(name) {
    if (FOOT[name]) return FOOT[name];
    const [index, events] = await Promise.all([
      fetch(`../footage/${name}/index.json`).then((r) => r.json()),
      fetch(`../footage/${name}/events.json`).then((r) => r.json()),
    ]);
    const idles = [];
    const open = {};
    for (const e of events) {
      if (e.type !== "mark") continue;
      const m = /^(.*):(begin|end)$/.exec(e.label);
      if (!m) continue;
      if (m[2] === "begin") open[m[1]] = e.t;
      else if (open[m[1]] != null) { idles.push([open[m[1]], e.t]); delete open[m[1]]; }
    }
    idles.sort((a, b) => a[0] - b[0]);
    const end = events.find((e) => e.label === "end")?.t ?? index[index.length - 1][0];
    const f = { name, index, events, idles, end };
    f.cuts = []; // compressed times where a wait was cut out
    let off = 0;
    for (const [b, e] of idles) { f.cuts.push(b - off); off += e - b; }
    f.cend = end - off;
    FOOT[name] = f;
    return f;
  }
  /** Compressed (waits removed) -> real take time. */
  function realOf(f, c) {
    let off = 0;
    for (const [b, e] of f.idles) {
      if (c + off >= b) off += e - b;
      else break;
    }
    return c + off;
  }
  function compOf(f, r) {
    let off = 0;
    for (const [b, e] of f.idles) {
      if (r >= e) off += e - b;
      else if (r > b) return b - off;
      else break;
    }
    return r - off;
  }
  function frameNo(f, r) {
    const ix = f.index;
    let lo = 0, hi = ix.length - 1;
    if (r <= ix[0][0]) return ix[0][1];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ix[mid][0] <= r) lo = mid; else hi = mid - 1;
    }
    return ix[lo][1];
  }
  const frameSrc = (f, r) => `../footage/${f.name}/${String(frameNo(f, r)).padStart(5, "0")}.jpg`;
  /** Image layers for compressed time c: one frame, or two while dissolving over a cut. */
  function layersAt(f, c) {
    const r = realOf(f, c);
    for (let k = f.cuts.length - 1; k >= 0; k--) {
      const cc = f.cuts[k];
      if (c >= cc && c - cc < DIS) {
        const before = f.idles[k][0] - 0.02;
        return [{ src: frameSrc(f, before), a: 1 }, { src: frameSrc(f, r), a: ease((c - cc) / DIS) }];
      }
      if (c >= cc) break;
    }
    return [{ src: frameSrc(f, r), a: 1 }];
  }

  const pending = [];
  function setSrc(img, src) {
    if (img.__src === src) return;
    img.__src = src;
    img.src = src;
    pending.push(img.decode().catch(() => {}));
  }

  /** A clean browser window showing footage. Page coordinates are CSS px of the 1440x900 recording. */
  class Browser {
    constructor(parent, x, y, w, h) {
      this.root = at(el("div", "browser", parent), x, y, w, h);
      const bar = el("div", "bar", this.root);
      [22, 42, 62].forEach((l) => (at(el("div", "dot", bar), l, 19).style.left = l + "px"));
      this.url = el("div", "url", bar);
      // The CapFare extension, pinned in the toolbar; its badge shows a check when it has an offer.
      this.ext = el("div", "ext", bar, `<svg width="27" height="21" viewBox="0 0 104 80"><g fill="#0b2447" stroke="#0b2447" stroke-width="9" stroke-linejoin="round"><path d="M9 74 L41 16 L60 16 L28 74 Z"/><path d="M45 74 L67 34 L86 34 L64 74 Z"/></g><g transform="translate(70 -2) rotate(45 15 15) scale(1.25)" fill="#0b2447"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></g></svg><span class="xb">✓</span>`);
      this.xb = this.ext.querySelector(".xb");
      this.view = el("div", "view", this.root);
      this.vw = w;
      this.vh = h - 50;
      this.imgs = [0, 1, 2, 3].map(() => el("img", "fr", this.view));
      this.imgs.forEach((i) => (i.style.width = "1440px"));
      this.rings = [0, 1].map(() => el("div", "ring", this.view));
      this.x = x; this.y = y; this.w = w; this.h = h;
    }
    setUrl(path, host = "app", badge = false) {
      O(this.xb, badge ? 1 : 0);
      const html = `<b>${HOSTS[host] ?? host}</b>${path}`;
      if (this.url.__h !== html) { this.url.innerHTML = html; this.url.__h = html; }
    }
    /** layers: [{src, a, crop:{x,y,w}}] bottom to top. */
    draw(layers) {
      this.imgs.forEach((img, i) => {
        const L = layers[i];
        if (!L) { V(img, false); return; }
        V(img, true);
        setSrc(img, L.src);
        const s = this.vw / L.crop.w;
        T(img, `translate(${r3(-L.crop.x * s)}px, ${r3(-L.crop.y * s)}px) scale(${r3(s)})`);
        O(img, L.a);
      });
    }
    /** Click rings: [{x, y, p}] in page px with progress p (0..1). */
    ringsAt(list, crop) {
      const s = this.vw / crop.w;
      this.rings.forEach((rg, i) => {
        const k = list[i];
        if (!k) { V(rg, false); return; }
        V(rg, true);
        const sx = (k.x - crop.x) * s, sy = (k.y - crop.y) * s;
        T(rg, `translate(${r3(sx)}px, ${r3(sy)}px) scale(${r3(0.45 + 0.9 * out3(k.p))})`);
        O(rg, (1 - k.p) * 0.95);
      });
    }
  }

  /** Crop keyframes [[u, x, y, w], ...] (u = 0..1 through the shot); h follows the view. */
  function cropAt(keys, u, vw, vh) {
    let k = keys[0];
    let res;
    if (u <= keys[0][0]) res = keys[0];
    else if (u >= keys[keys.length - 1][0]) res = keys[keys.length - 1];
    else {
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (u >= a[0] && u <= b[0]) {
          const p = ease((u - a[0]) / (b[0] - a[0]));
          res = [u, lerp(a[1], b[1], p), lerp(a[2], b[2], p), lerp(a[3], b[3], p)];
          break;
        }
      }
    }
    const w = Math.min(1440, res[3]);
    const h = (w * vh) / vw;
    return { x: clamp(res[1], 0, 1440 - w), y: clamp(res[2], 0, Math.max(0, 900 - h)), w };
  }

  /**
   * Automatic camera for a shot: holds on the action and eases to each click just before it
   * happens. opts: { w (crop width, CSS px), bias (0 = page centre, 1 = click x), y (fixed
   * centre y), x0 (fixed left edge, for left-aligned app pages), start: [cx, cy] }. Returns crop keyframes [[u, x, y, w], ...].
   */
  function autoCrop(f, from, to, browser, opts) {
    const w = opts.w ?? 1000;
    const h = (w * browser.vh) / browser.vw;
    const bias = opts.bias ?? 0.55;
    const ks = f.events
      .filter((e) => e.type === "click")
      .map((e) => ({ c: compOf(f, e.t), x: e.x * 1440, y: e.y * 900 }))
      .filter((k) => k.c >= from - 0.3 && k.c <= to + 0.1);
    const span = Math.max(0.01, to - from);
    const ctr = (k) => [opts.x0 != null ? opts.x0 + w / 2 : 720 + (k.x - 720) * bias, opts.y ?? k.y];
    const kf = (u, [cx, cy]) => [clamp(u), cx - w / 2, cy - h / 2, w];
    if (!ks.length) return [kf(0, opts.start ?? [opts.x0 != null ? opts.x0 + w / 2 : 720, opts.y ?? h / 2])];
    const out = [kf(0, opts.start ?? ctr(ks[0]))];
    let prev = ks[0].c;
    ks.forEach((k, i) => {
      const move = Math.min(1.0, i ? (k.c - prev) * 0.75 : 0.9);
      const u0 = (k.c - move - from) / span, u1 = (k.c - 0.1 - from) / span;
      if (u1 > 0) {
        const last = out[out.length - 1];
        if (u0 > last[0]) out.push([clamp(u0), last[1], last[2], w]);
        out.push(kf(Math.max(u1, last[0] + 0.001), ctr(k)));
      }
      prev = k.c;
    });
    return out;
  }

  /**
   * Footage track: shots played one after another in a browser, starting at local time t0.
   * shot: { take, from, to, len, crop: [[u,x,y,w]...], url }. from/to are compressed take
   * seconds (waits removed). Returns render(lt).
   */
  function Track(beat, browser, t0, shots) {
    let t = t0;
    shots = shots.filter((s) => !(CUT === "x" && s.x === false));
    // Fit the shots into the beat (footage may run on under the outgoing transition).
    const avail = beat.dur - t0 + TR / 2 - 0.1;
    const want = shots.reduce((a, s) => a + (s.len ?? (s.to ?? FOOT[s.take].cend) - s.from), 0);
    const fit = Math.min(1, avail / want);
    const S2 = shots.map((s) => {
      const f = FOOT[s.take];
      const to = s.to ?? f.cend;
      const len = (s.len ?? to - s.from) * fit;
      const o = { ...s, f, to, len, at: t, rate: (to - s.from) / len };
      o.crop = Array.isArray(s.crop) ? s.crop : autoCrop(f, s.from, to, browser, s.crop ?? {});
      o.clicks = f.events
        .filter((e) => e.type === "click")
        .map((e) => ({ x: e.x * 1440, y: e.y * 900, c: compOf(f, e.t), label: e.label }))
        .filter((k) => k.c >= s.from && k.c <= to)
        .map((k) => ({ ...k, lt: o.at + (k.c - s.from) / o.rate }));
      o.clicks.forEach((k) => cue(beat.start + k.lt, "click", 0.8));
      t += len;
      return o;
    });
    const end = t;
    function stateAt(o, lt) {
      const c = clamp(s2c(o, lt), o.from, o.to);
      const u = clamp((lt - o.at) / o.len);
      const crop = cropAt(o.crop, u, browser.vw, browser.vh);
      return { c, crop };
    }
    const s2c = (o, lt) => o.from + (lt - o.at) * o.rate;
    return {
      end,
      shots: S2,
      render(lt) {
        let i = S2.findIndex((o) => lt < o.at + o.len);
        if (i < 0) i = S2.length - 1;
        const o = S2[i];
        const st = stateAt(o, lt);
        let layers = layersAt(o.f, st.c).map((L) => ({ ...L, crop: st.crop }));
        if (i > 0 && lt - o.at < XF) {
          const pv = S2[i - 1];
          const ps = stateAt(pv, pv.at + pv.len);
          const mix = ease((lt - o.at) / XF);
          layers = [{ src: frameSrc(pv.f, realOf(pv.f, ps.c)), a: 1, crop: ps.crop }, ...layers.map((L) => ({ ...L, a: L.a * mix }))];
        }
        browser.draw(layers);
        browser.setUrl(o.url ?? "", o.host, !!o.badge && lt - o.at > (o.badgeAt ?? 0));
        browser.ringsAt(o.clicks.filter((k) => lt >= k.lt && lt - k.lt < 0.75).map((k) => ({ x: k.x, y: k.y, p: (lt - k.lt) / 0.75 })), st.crop);
      },
    };
  }

  // ---------- graphic primitives ----------
  /** Round badge: check, x, info, or a number. Returns {el, render(p)}. */
  function Badge(parent, kind, size, theme) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("viewBox", "0 0 48 48");
    s.classList.add("badge");
    parent.appendChild(s);
    const dark = theme === "navy" || theme === "ink";
    const fill = { check: dark ? C.yellow : C.green, x: dark ? C.lav : C.ink, info: dark ? "#ffffff" : C.blue, dot: dark ? C.yellow : C.blue }[kind];
    const fg = { check: dark ? C.onYellow : "#fff", x: dark ? C.ink : "#fff", info: dark ? C.navy : "#fff", dot: "none" }[kind];
    const circ = sv("circle", s, { cx: 24, cy: 24, r: 23, fill });
    let path, len = 40;
    if (kind === "check") path = sv("path", s, { d: "M14 24.5 L21 31.5 L34.5 17", fill: "none", stroke: fg, "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round" });
    if (kind === "x") path = sv("path", s, { d: "M16 16 L32 32 M32 16 L16 32", fill: "none", stroke: fg, "stroke-width": 5, "stroke-linecap": "round" });
    if (kind === "info") {
      sv("circle", s, { cx: 24, cy: 14.5, r: 3.2, fill: fg });
      path = sv("path", s, { d: "M24 22 L24 35", fill: "none", stroke: fg, "stroke-width": 5.5, "stroke-linecap": "round" });
      len = 14;
    }
    if (path) { path.setAttribute("stroke-dasharray", len); }
    return {
      el: s,
      render(p) {
        T(s, `scale(${r3(clamp(back(clamp(p / 0.6)), 0, 1.2))})`);
        O(s, clamp(p * 4));
        if (path) A(path, "stroke-dashoffset", r3(len * (1 - out3(seg(p, 0.3, 0.9)))));
        void circ;
      },
    };
  }

  /** Rows of round badges with text, appearing at their own times. items: [{kind, text, sub, at}] */
  function Rows(layer, theme, x, y, items, { gap = 84, size = 46, font = 32 } = {}) {
    const rows = items.map((it, i) => {
      const r = at(el("div", "row", layer), x, y + i * gap);
      const b = Badge(r, it.kind, size, theme);
      const tx = el("div", "rtext", r, it.text + (it.sub ? `<span class="rsub dim">${it.sub}</span>` : ""));
      tx.style.fontSize = font + "px";
      return { r, b, tx, at: it.at, kind: it.kind };
    });
    return {
      rows,
      cues(beat) { rows.forEach((o) => cueB(beat, S(o.at) + 0.15, o.kind === "x" ? "deny" : o.kind === "check" ? "check" : "tick")); },
      render(lt) {
        rows.forEach((o) => {
          const p = seg(lt, S(o.at), S(o.at) + 0.9);
          O(o.r, p > 0 ? 1 : 0);
          o.b.render(p);
          const q = out3(seg(lt, S(o.at) + 0.12, S(o.at) + 0.75));
          O(o.tx, q);
          T(o.tx, `translateX(${r3((1 - q) * -18)}px)`);
        });
      },
    };
  }

  /** Smooth path through points (Catmull-Rom). */
  function smoothPath(pts) {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${r3(c1[0])} ${r3(c1[1])} ${r3(c2[0])} ${r3(c2[1])} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  /** Line that draws itself; returns {path, len, point(p), render(p)}. */
  function DrawLine(svg, d, attrs) {
    const p = sv("path", svg, { d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs });
    const len = p.getTotalLength();
    p.setAttribute("stroke-dasharray", `${len} ${len + 10}`);
    return {
      path: p,
      len,
      point: (q) => p.getPointAtLength(clamp(q) * len),
      render(q) { A(p, "stroke-dashoffset", r3(len * (1 - clamp(q)))); },
    };
  }

  /** Words masked from below, like the headline. */
  function MaskText(layer, cls, x, y, text, color) {
    const h = at(el("div", cls, layer), x, y);
    if (color) h.style.color = color;
    const ws = text.split(" ").map((w) => el("span", "w", el("span", "mask", h), w));
    return {
      el: h,
      render(lt, a, stag = 0.05, d = 0.6) {
        ws.forEach((w, i) => {
          const p = out3(seg(lt, S(a) + i * stag, S(a) + i * stag + d));
          T(w, `translateY(${r3((1 - p) * 112)}%)`);
        });
      },
    };
  }

  /** Simple flight/ticket icons as inline SVG strings. */
  const ICON = {
    plane: (c) => `<svg width="44" height="44" viewBox="0 0 24 24"><path fill="${c}" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`,
    person: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><circle cx="32" cy="22" r="11" fill="none" stroke="${c}" stroke-width="4"/><path d="M12 56c2-11 10-17 20-17s18 6 20 17" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
    key: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><circle cx="22" cy="32" r="11" fill="none" stroke="${c}" stroke-width="4.5"/><path d="M33 32h22M47 32v9M55 32v7" fill="none" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/></svg>`,
    mail: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><rect x="7" y="14" width="50" height="36" rx="6" fill="none" stroke="${c}" stroke-width="4"/><path d="M9 18l23 18 23-18" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/></svg>`,
    bell: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M18 44V30a14 14 0 0 1 28 0v14l4 5H14z" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/><path d="M27 54a5 5 0 0 0 10 0" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
    vault: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><rect x="8" y="10" width="48" height="42" rx="7" fill="none" stroke="${c}" stroke-width="4"/><circle cx="32" cy="31" r="10" fill="none" stroke="${c}" stroke-width="4"/><path d="M32 21v4M32 37v4M22 31h4M38 31h4M16 52v5M48 52v5" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
    bank: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M8 24L32 10l24 14zM12 52h40M14 28v18M25 28v18M39 28v18M50 28v18" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    swap: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M12 22h36l-9-9M52 42H16l9 9" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    wallet: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><rect x="8" y="16" width="48" height="36" rx="7" fill="none" stroke="${c}" stroke-width="4"/><path d="M40 30h16v10H40a5 5 0 0 1 0-10zM14 16l26-8 4 8" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/></svg>`,
    link: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M27 37l10-10M24 30l-6 6a8 8 0 0 0 11 11l6-6M40 34l6-6a8 8 0 0 0-11-11l-6 6" fill="none" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/></svg>`,
    eye: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M6 32s10-16 26-16 26 16 26 16-10 16-26 16S6 32 6 32z" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="32" r="7" fill="none" stroke="${c}" stroke-width="4"/></svg>`,
    chip: (c, s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><rect x="16" y="16" width="32" height="32" rx="5" fill="none" stroke="${c}" stroke-width="4"/><path d="M24 8v8M32 8v8M40 8v8M24 48v8M32 48v8M40 48v8M8 24h8M8 32h8M8 40h8M48 24h8M48 32h8M48 40h8" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
  };

  /** The CapFare mark (two slanted bars and a climbing plane). */
  function logoMark(color, size) {
    return `<svg width="${size * 1.3}" height="${size}" viewBox="0 0 104 80"><g class="bars" fill="${color}" stroke="${color}" stroke-width="9" stroke-linejoin="round"><path class="b1" d="M9 74 L41 16 L60 16 L28 74 Z"/><path class="b2" d="M45 74 L67 34 L86 34 L64 74 Z"/></g><g class="pl"><g transform="translate(70 -2) rotate(45 15 15) scale(1.25)" fill="${color}"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></g></g></svg>`;
  }

  // ---------- beat scaffolding ----------
  function Headline(layer, beat) {
    const k = el("div", "kicker", layer, beat.kicker ?? "");
    const h = el("h1", "title", layer);
    const ws = (beat.title ?? "").split(" ").map((w) => el("span", "w", el("span", "mask", h), w));
    return (lt) => {
      const pk = out3(seg(lt, S(0.15), S(0.15) + 0.7));
      O(k, pk);
      T(k, `translateX(${r3((1 - pk) * -24)}px)`);
      ws.forEach((w, i) => {
        const p = out3(seg(lt, S(0.3) + i * 0.045, S(0.3) + i * 0.045 + 0.75));
        T(w, `translateY(${r3((1 - p) * 112)}%)`);
      });
    };
  }
  function Motif(layer, side = "right") {
    const bars = [0, 1].map((i) => el("div", "motif", layer));
    const base = side === "right" ? [1380, 1760] : [-260, 120];
    return (lt) => {
      bars.forEach((b, i) => {
        const x = base[i] + lt * (i ? 5 : 8) - 40;
        T(b, `translate(${r3(x)}px, 0) skewX(-28deg)`);
        b.style.left = "0px";
      });
    };
  }

  // Standard layout: title on top, browser on one side, graphic column on the other.
  const BR = { right: [744, 252, 1080, 668], left: [96, 252, 1080, 668] };
  const COL = { right: 96, left: 1236 }; // graphic column x for browser right / left
  const COLW = 590;

  /** Footage plan per beat (filled from the recorded takes; see SHOTS below). */
  const SHOTS = { ...(window.SHOTS ?? {}), ...(CUT === "x" ? window.SHOTS_X ?? {} : {}) };
  const shotList = (id) => { const s = SHOTS[id]; return !s ? [] : Array.isArray(s) ? s : Object.values(s).flat().filter((x) => x && x.take); };
  // Numbers shown in graphics, as they appear in the recordings (shots.js).
  const F = { cap: 180, risen: 260, booked: 260, payout: 75, deductible: 5, maxPayout: 150, dropBooked: 0, dropNow: 0, dropPaid: 0, dropDeductible: 3, ...(window.FACTS ?? {}) };

  // ---------- builders ----------
  const B = {};

  B.intro = (L, beat) => {
    // Webcam placeholder on the left (see #cam); the price story on the right.
    const x0 = 1040;
    const lab1 = at(el("div", "lab dim txt", L, "Today"), x0, 196);
    const p1 = at(el("div", "h-big txt", L, "€170"), x0 - 6, 236);
    const lab2 = at(el("div", "lab dim txt", L, "A day later, the same seat"), x0 + 420, 196);
    const p2 = at(el("div", "h-big txt", L, "€260"), x0 + 414, 236);
    p2.style.color = C.yellow;
    const s = svgBox(L, x0, 440, 780, 360);
    const pts = [[0, 300], [90, 284], [170, 292], [260, 250], [340, 222], [420, 160], [500, 120], [560, 104]];
    const ln = DrawLine(s, smoothPath(pts), { stroke: C.yellow, "stroke-width": 7 });
    const pts2 = [[560, 104], [610, 112], [660, 150], [720, 196], [770, 206]];
    const ln2 = DrawLine(s, smoothPath(pts2), { stroke: C.lav, "stroke-width": 7, "stroke-dasharray": "2 14" });
    const dot = sv("circle", s, { r: 11, fill: C.yellow });
    sv("line", s, { x1: 0, y1: 330, x2: 780, y2: 330, stroke: "rgba(255,255,255,0.16)", "stroke-width": 2 });
    const booked = at(el("div", "lab txt", L, "You book at €260"), x0 + 430, 486);
    const next = at(el("div", "lab dim txt", L, "Next morning: €215"), x0 + 520, 680);
    const ln2t = 4.9;
    cueB(beat, (wordTime(beat, /^170$/) ?? 1.6) - 0.6, "land");
    cueB(beat, (wordTime(beat, /^260$/) ?? 3.1) - 0.5, "land");
    cueB(beat, ln2t + 0.2, "tick");
    // With a recorded voice, each figure lands on its word.
    const w170 = wordTime(beat, /^170$/), w260 = wordTime(beat, /^260$/), wBook = wordTime(beat, /^book,$/), wCheap = wordTime(beat, /^cheaper\.$/);
    const T1 = w170 != null ? w170 - 0.6 : 0.7, T2 = w260 != null ? w260 - 0.5 : 2.3, TB = wBook != null ? wBook - 0.3 : 4.3, TN = wCheap != null ? wCheap - 0.9 : 6.1;
    return (lt) => {
      rise(lab1, lt, T1); rise(p1, lt, T1 + 0.1, 0.8, 40);
      rise(lab2, lt, T2 - 0.1); rise(p2, lt, T2, 0.8, 40);
      const q = ease(seg(lt, T1 + 0.3, T2 + 0.8));
      ln.render(q);
      const pt = ln.point(q);
      A(dot, "cx", r3(pt.x)); A(dot, "cy", r3(pt.y));
      O(dot, seg(lt, T1 + 0.3, T1 + 0.5));
      rise(booked, lt, TB);
      ln2.render(ease(seg(lt, TB + 0.4, TN + 0.6)));
      rise(next, lt, TN);
      // gentle settle of the whole graphic
      T(s, `translateY(${r3(Math.sin(lt * 0.6) * 3)}px)`);
    };
  };

  B.logo = (L, beat) => {
    // Left-aligned block, centred as a whole (the tagline is the widest line).
    const g = at(el("div", "", L, logoMark(C.onYellow, 150)), 392, 300);
    const word = MaskText(L, "h-big txt", 632, 312, "CapFare");
    word.el.style.fontSize = "168px";
    const line = MaskText(L, "h-sm txt", 398, 560, "Lock the price of your flight, wherever you book.");
    line.el.style.fontSize = "52px";
    line.el.style.fontWeight = "550";
    const near = at(el("div", "lab txt", L, "Runs on NEAR"), 402, 660);
    near.style.fontSize = "30px";
    const b1 = g.querySelector(".b1"), b2 = g.querySelector(".b2"), pl = g.querySelector(".pl");
    cueB(beat, 0.35, "logo");
    return (lt) => {
      const p1 = out3(seg(lt, 0.2, 0.9)), p2 = out3(seg(lt, 0.32, 1.02));
      b1.setAttribute("transform", `translate(0 ${r3((1 - p1) * 90)})`); O(b1, p1);
      b2.setAttribute("transform", `translate(0 ${r3((1 - p2) * 90)})`); O(b2, p2);
      const pp = ease(seg(lt, 0.55, 1.45));
      pl.setAttribute("transform", `translate(${r3((1 - pp) * -60)} ${r3((1 - pp) * 50)})`); O(pl, seg(lt, 0.55, 0.8));
      word.render(lt, 0.6, 0.0, 0.8);
      line.render(lt, 1.3, 0.035, 0.6);
      rise(near, lt, (wordTime(beat, /^NEAR\.$/) ?? 2.6) - 0.3);
    };
  };

  /** Generic feature beat: headline, motif, browser with footage, and a custom graphic. */
  function feature(side, graphic) {
    return (L, beat) => {
      const head = Headline(L, beat);
      const motif = Motif(L, side === "right" ? "left" : "right");
      const br = new Browser(L, ...BR[side]);
      const shots = Array.isArray(SHOTS[beat.id]) ? SHOTS[beat.id] : [];
      const track = shots.length ? Track(beat, br, 0.55, shots) : null;
      const gx = COL[side];
      const gfx = graphic ? graphic(L, beat, gx, 268, track) : () => {};
      return (lt) => {
        head(lt);
        motif(lt);
        const p = out3(seg(lt, S(0.35), S(0.35) + 0.9));
        O(br.root, p);
        T(br.root, `translate(${r3((1 - p) * (side === "right" ? 50 : -50))}px, ${r3((1 - p) * 20)}px)`);
        if (track) track.render(lt);
        gfx(lt * beat.k);
      };
    };
  }

  // 01 Find a flight: the ticket the extension recognised.
  B.find = feature("right", (L, beat, x, y) => {
    const card = at(el("div", "card", L), x, y + 40, COLW, 420);
    const head = at(el("div", "lab dim txt", L, "Recognised on the page"), x + 40, y + 76);
    const fn = at(el("div", "h-mid txt", L, "KL1695"), x + 40, y + 120);
    const rows = Rows(L, beat.bg, x + 40, y + 226, [
      { kind: "check", text: "Amsterdam to Barcelona", at: 2.4 },
      { kind: "check", text: "14 June 2027", at: 3.1 },
      { kind: "check", text: "Economy Light, 1 adult", at: 3.8 },
    ], { gap: 70, size: 40, font: 29 });
    rows.cues(beat);
    const note = at(el("div", "lab dim txt", L, "Any booking site. Here: our demo site."), x, y + 500);
    return (lt) => {
      rise(card, lt, 1.1, 0.8, 30);
      rise(head, lt, 1.4); rise(fn, lt, 1.6, 0.7, 20);
      rows.render(lt);
      rise(note, lt, 5.0);
    };
  });

  // 02 Account: passkey -> readable name, relayer pays gas.
  B.account = feature("left", (L, beat, x, y) => {
    const ic = at(el("div", "", L, ICON.key(C.yellow, 76)), x, y + 30);
    const lab = at(el("div", "lab dim txt", L, "Passkey creates"), x + 100, y + 52);
    const nm = at(el("div", "h-sm txt", L, "anna-devries"), x, y + 130);
    nm.style.fontSize = "54px";
    const nm2 = at(el("div", "lab dim txt", L, ".capfare.testnet"), x + 2, y + 196);
    const rows = Rows(L, beat.bg, x, y + 290, [
      { kind: "check", text: "No seed phrase", at: 3.2 },
      { kind: "check", text: "No wallet to install", at: 3.8 },
      { kind: "check", text: "Every gas fee paid", sub: "by the CapFare relayer", at: 4.4 },
    ], { gap: 82, size: 42, font: 30 });
    rows.cues(beat);
    return (lt) => {
      pop(ic, lt, 1.0); rise(lab, lt, 1.2);
      rise(nm, lt, 1.7, 0.8, 22); rise(nm2, lt, 2.0);
      rows.render(lt);
    };
  });

  // 03 Credit: a top-up that pays premiums.
  B.credit = feature("right", (L, beat, x, y) => {
    const lab = at(el("div", "lab dim txt", L, "Prepaid credit"), x, y + 60);
    const big = at(el("div", "h-big txt", L, "€0"), x - 6, y + 100);
    const sub = at(el("div", "lab txt", L, "Pays premiums, no card fee per policy"), x, y + 270);
    const sim = at(el("div", "lab dim txt", L, "iDEAL top-up simulated on testnet"), x, y + 320);
    cueB(beat, 2.6, "check");
    return (lt) => {
      rise(lab, lt, 1.0);
      rise(big, lt, 1.1, 0.7, 30);
      const v = Math.round(20 * ease(seg(lt, 1.6, 2.8)));
      const s = "€" + v;
      if (big.__s !== s) { big.textContent = s; big.__s = s; }
      rise(sub, lt, 2.4); rise(sim, lt, 3.0);
    };
  });

  // 04 Price Cap: public formula, max payout locked in the vault before paying.
  B.lock = feature("left", (L, beat, x, y) => {
    const lab = at(el("div", "lab dim txt", L, "Premium, from a public formula"), x, y + 20);
    const parts = ["base rate", "price momentum", "seats left", "season", "vault use", "your cap"];
    const ps = parts.map((p, i) => at(el("div", "lab txt", L, (i ? "× " : "") + p), x + (i % 2) * 290, y + 70 + Math.floor(i / 2) * 48));
    const rule = at(el("div", "rule", L), x, y + 232, COLW - 40, 2);
    const vic = at(el("div", "", L, ICON.vault(C.yellow, 84)), x, y + 268);
    const vl = at(el("div", "lab dim txt", L, "Locked in the vault first"), x + 108, y + 276);
    const vv = at(el("div", "h-mid txt", L, `€${F.maxPayout}`), x + 106, y + 310);
    const vs = at(el("div", "lab txt", L, "maximum payout"), x + 290, y + 334);
    const rows = Rows(L, beat.bg, x, y + 440, [{ kind: "check", text: "Then you pay the premium", at: 7.2 }], { size: 42, font: 30 });
    rows.cues(beat);
    cueB(beat, 5.4, "land");
    return (lt) => {
      rise(lab, lt, 1.0);
      ps.forEach((p, i) => rise(p, lt, 1.4 + i * 0.28, 0.6, 16));
      O(rule, out3(seg(lt, 4.6, 5.2)));
      pop(vic, lt, 5.2); rise(vl, lt, 5.4); rise(vv, lt, 5.6, 0.7, 20); rise(vs, lt, 5.8);
      rows.render(lt);
    };
  });

  // 05 Choices: deductible and duration change the premium.
  B.choices = feature("right", (L, beat, x, y, track) => {
    const d = window.OPTION_PRICES ?? { ded: [["€5", 1], ["€10", 0.74], ["€25", 0.29], ["€50", 0.15]], dur: [["3 days", 0.39], ["7 days", 1], ["14 days", 2.34], ["30 days", 3.0]] };
    const lab1 = at(el("div", "lab dim txt", L, "Higher deductible, lower premium"), x, y + 10);
    const s1 = svgBox(L, x, y + 56, COLW, 170);
    const bars1 = d.ded.map(([k, v], i) => {
      const bx = i * 140;
      const r = sv("rect", s1, { x: bx, width: 96, y: 140, height: 0, rx: 10, fill: beat.bg === "light" ? C.blue : C.yellow });
      const t = sv("text", s1, { x: bx + 48, y: 168, "text-anchor": "middle", "font-family": "Atkinson Hyperlegible Next", "font-size": 22, fill: beat.bg === "light" ? C.ink : "#fff" });
      t.textContent = k;
      return { r, v, bx };
    });
    const lab2 = at(el("div", "lab dim txt", L, "Lock for 3 to 30 days"), x, y + 290);
    const s2 = svgBox(L, x, y + 336, COLW, 170);
    const bars2 = d.dur.map(([k, v], i) => {
      const bx = i * 140;
      const r = sv("rect", s2, { x: bx, width: 96, y: 140, height: 0, rx: 10, fill: beat.bg === "light" ? C.link : C.lav });
      const t = sv("text", s2, { x: bx + 48, y: 168, "text-anchor": "middle", "font-family": "Atkinson Hyperlegible Next", "font-size": 22, fill: beat.bg === "light" ? C.ink : "#fff" });
      t.textContent = k;
      return { r, v };
    });
    const max1 = Math.max(...bars1.map((b) => b.v)), max2 = Math.max(...bars2.map((b) => b.v));
    return (lt) => {
      rise(lab1, lt, 1.0);
      bars1.forEach((b, i) => { const h = 112 * (b.v / max1) * out3(seg(lt, 1.4 + i * 0.18, 2.3 + i * 0.18)); A(b.r, "y", r3(140 - h)); A(b.r, "height", r3(h)); });
      rise(lab2, lt, 3.4);
      bars2.forEach((b, i) => { const h = 112 * (b.v / max2) * out3(seg(lt, 3.8 + i * 0.18, 4.7 + i * 0.18)); A(b.r, "y", r3(140 - h)); A(b.r, "height", r3(h)); });
    };
  });

  // 06 Alerts: the price passes the cap -> alert.
  B.alerts = feature("left", (L, beat, x, y) => {
    const s = svgBox(L, x, y + 30, COLW, 300);
    const capY = 130;
    sv("line", s, { x1: 0, y1: capY, x2: COLW - 20, y2: capY, stroke: C.lav, "stroke-width": 3, "stroke-dasharray": "10 10" });
    const capL = at(el("div", "lab-sm dim txt", L, `Your cap €${F.cap}`), x, y + 30 + capY - 40);
    const pts = [[0, 250], [80, 236], [160, 240], [240, 200], [320, 168], [390, 120], [460, 86], [540, 70]];
    const ln = DrawLine(s, smoothPath(pts), { stroke: C.yellow, "stroke-width": 7 });
    const dot = sv("circle", s, { r: 10, fill: C.yellow });
    const card = at(el("div", "card solid", L), x, y + 360, COLW - 20, 150);
    const bi = at(el("div", "", card, ICON.bell(C.blue, 52)), 26, 26);
    const ct = at(el("div", "", card, `<div class="lab" style="font-weight:600">KL1695 passed your cap</div><div class="lab-sm" style="color:${C.muted};margin-top:6px">Now €${F.risen}, your cap €${F.cap}. Book, then claim the difference.</div>`), 96, 30, COLW - 140);
    const rows = Rows(L, beat.bg, x, y + 548, [{ kind: "check", text: "In the app, by push or by email", at: 7.4 }], { size: 40, font: 28 });
    rows.cues(beat);
    cueB(beat, 4.6, "alert");
    void bi; void ct;
    return (lt) => {
      rise(capL, lt, 1.0);
      const q = ease(seg(lt, 1.2, 4.4));
      ln.render(q);
      const pt = ln.point(q);
      A(dot, "cx", r3(pt.x)); A(dot, "cy", r3(pt.y)); O(dot, seg(lt, 1.2, 1.4));
      const pc = seg(lt, 4.5, 5.2);
      O(card, Math.min(1, pc * 2));
      T(card, `translateY(${r3((1 - back(pc)) * -40)}px)`);
      rows.render(lt);
    };
  });

  function old07() { return feature("right", (L, beat, x, y) => {
    const steps = window.CLAIM_STEPS ?? [
      ["Booked anywhere", "Skyline Travel, our demo site", 1.2],
      ["Claim with the original email", "checked, then held", 3.6],
      ["Free cancellation passes", "24 hours (30 seconds on the demo)", 6.4],
      ["Live check of the booking", "still booked, same flight", 8.6],
      ["Paid from the vault", `€${F.payout}: paid €${F.booked}, cap €${F.cap}, deductible €${F.deductible}`, 10.4],
    ];
    const s = svgBox(L, x, y + 30, 60, 520);
    sv("line", s, { x1: 22, y1: 20, x2: 22, y2: 500, stroke: beat.bg === "light" ? C.line : "rgba(255,255,255,.18)", "stroke-width": 4, "stroke-linecap": "round" });
    const prog = DrawLine(s, "M22 20 L22 500", { stroke: C.blue, "stroke-width": 4 });
    const items = steps.map(([t, sub, a], i) => {
      const yy = 20 + i * 120;
      const b = Badge(at(el("div", "", L), x, y + 30 + yy - 22), i === steps.length - 1 ? "check" : "dot", 44, beat.bg);
      const tx = at(el("div", "", L, `<div class="lab" style="font-weight:600">${t}</div>${sub ? `<div class="lab-sm dim">${sub}</div>` : ""}`), x + 70, y + 30 + yy - 24);
      return { b, tx, a };
    });
    items.forEach((o, i) => cueB(beat, S(o.a) + 0.1, i === items.length - 1 ? "check" : "tick"));
    return (lt) => {
      const last = items[items.length - 1].a;
      prog.render(ease(seg(lt, items[0].a, last)));
      items.forEach((o) => { o.b.render(seg(lt, S(o.a), S(o.a) + 0.9)); rise(o.tx, lt, o.a + 0.1, 0.6, 14); });
    };
  }); }

  // 07 Book and claim. With a side-by-side plan (shots.js: { left, right }): the email claim
  // (approved, payout held) next to the live check a day later (paid), under one timeline.
  const claimTimeline = old07();
  B.claim = (L, beat) => {
    const plan = SHOTS.claim;
    if (!plan || Array.isArray(plan)) return claimTimeline(L, beat);
    const head = Headline(L, beat);
    const motif = Motif(L, "left");
    const tw = (re, d) => wordTime(beat, re) ?? d;
    const PW = 852, PH = 470, PY = 318;
    const panes = [
      { x: 96, n: "1", t: "Claim with the original email", sub: `approved, €${F.payout}, payout held`, shots: plan.left, at: 0.55 },
      { x: 972, n: "2", t: "A day later: live check of the booking", sub: "still booked, so it's paid from the vault", shots: plan.right, at: plan.rightAt ?? 6.2 },
    ].map((o) => {
      const lab = at(el("div", "", L, `<span class="num">${o.n}</span><span class="lab" style="font-weight:650">${o.t}</span>`), o.x, PY - 64);
      lab.className = "panelhead";
      const sub = at(el("div", "lab-sm dim txt", L, o.sub), o.x + 56, PY - 26);
      const br = new Browser(L, o.x, PY, PW, PH);
      const track = Track(beat, br, o.at, o.shots);
      return { ...o, lab, sub, br, track };
    });
    // Timeline under the panels: booked -> claimed (held) -> free-cancellation day -> live check -> paid.
    const TY = 852;
    const tl = svgBox(L, 96, TY, 1728, 60);
    sv("line", tl, { x1: 10, y1: 20, x2: 1718, y2: 20, stroke: C.line, "stroke-width": 4, "stroke-linecap": "round" });
    const prog = DrawLine(tl, "M10 20 L1718 20", { stroke: C.blue, "stroke-width": 4 });
    const stops = [
      [10, "Booked", 0.6], [430, "Claimed: approved, held", tw(/^Claim$/, 0.7) + 0.6],
      [870, "Free cancellation: 24 h", tw(/^waits$/, 3) + 0.3], [1290, "Live check", tw(/^live$/, 4) + 0.2], [1718, `Paid €${F.payout}`, tw(/^paid$/, 7) + 0.1],
    ].map(([x, t, a], i) => {
      const d = sv("circle", tl, { cx: x, cy: 20, r: 9, fill: i === 4 ? C.green : C.blue });
      const lab = at(el("div", "lab-sm txt", L, t), 96 + x + (i === 4 ? -110 : i === 0 ? 0 : -60), TY + 34);
      lab.style.fontWeight = "600";
      return { d, lab, x, a, i };
    });
    stops.forEach((o) => cueB(beat, o.a, o.i === 4 ? "check" : "tick", 0.7));
    return (lt) => {
      head(lt);
      motif(lt);
      panes.forEach((o, i) => {
        const p = out3(seg(lt, 0.35 + i * 0.25, 1.25 + i * 0.25));
        [o.lab, o.sub, o.br.root].forEach((e) => { O(e, p); T(e, `translateY(${r3((1 - p) * 24)}px)`); });
        // The pane that is playing is at full strength; the other rests a little dimmer.
        const active = i === 0 ? lt < o.at + 0.2 || lt < panes[1].at : lt >= o.at - 0.2;
        O(o.br.root, p * (active ? 1 : 0.62));
        o.track.render(Math.max(lt, o.at));
      });
      const last = stops[stops.length - 1].a;
      prog.render(ease(seg(lt, 0.6, last)));
      stops.forEach((o) => {
        const q = seg(lt, o.a - 0.1, o.a + 0.5);
        A(o.d, "r", r3(4 + 5 * back(q)));
        O(o.d, q > 0 ? 1 : 0);
        rise(o.lab, lt, o.a - 0.05, 0.5, 10);
      });
    };
  };

  // 08 Verification: the booking checked live from the booking site; only flight, fare and price
  // go on-chain; edited, reused and other people's bookings are refused.
  B.verify = feature("left", (L, beat, x, y) => {
    const tw = (re, d) => wordTime(beat, re) ?? d;
    const ic = at(el("div", "", L, ICON.chip(C.yellow, 56)), x, y + 4);
    const il = at(el("div", "", L, `<div class="lab" style="font-weight:600">Booking checker</div><div class="lab-sm dim">reads the booking page itself</div>`), x + 78, y + 6);
    const card = at(el("div", "card solid", L), x, y + 96, COLW - 20, 216);
    card.innerHTML = `<div style="position:absolute;left:28px;top:20px;right:24px"><div class="lab-sm" style="color:${C.muted}">On-chain, nothing else</div>
      <div class="vrow"><span>Flight</span><b>KL1695 AMS → BCN</b></div><div class="vrow"><span>Fare</span><b>Economy Light</b></div><div class="vrow"><span>Price</span><b>€${F.verified ?? 170}</b></div></div>`;
    const rows = Rows(L, beat.bg, x, y + 350, [
      { kind: "x", text: "Edited email", at: tw(/^Edited$/, 4.7) },
      { kind: "x", text: "Booking already used", at: tw(/^reused$/, 5.6) },
      { kind: "x", text: "Someone else's booking", at: tw(/^other$/, 6.6) },
    ], { gap: 70, size: 40, font: 30 });
    rows.cues(beat);
    cueB(beat, tw(/^Only$/, 0.7) + 0.4, "land");
    return (lt) => {
      pop(ic, lt, 0.8); rise(il, lt, 0.9);
      rise(card, lt, tw(/^Only$/, 0.7) + 0.3, 0.7, 20);
      rows.render(lt);
    };
  });

  // 09 Drop Guarantee: price falls after booking; the difference is paid.
  B.drop = feature("right", (L, beat, x, y) => {
    const s = svgBox(L, x, y + 40, COLW, 330);
    const bookY = 90;
    sv("line", s, { x1: 0, y1: bookY, x2: COLW - 30, y2: bookY, stroke: C.muted, "stroke-width": 3, "stroke-dasharray": "10 10" });
    const bl = at(el("div", "lab-sm dim txt", L, `You booked at €${F.dropBooked}`), x, y + 40 + bookY - 40);
    const pts = [[0, bookY], [100, 96], [190, 120], [280, 170], [360, 210], [440, 236], [540, 246]];
    const ln = DrawLine(s, smoothPath(pts), { stroke: C.blue, "stroke-width": 7 });
    const area = sv("path", s, { d: smoothPath(pts) + ` L540 ${bookY} L0 ${bookY} Z`, fill: "rgba(36,108,66,0.14)" });
    const big = at(el("div", "h-mid txt", L, `€${F.dropPaid}`), x, y + 40 + 326);
    big.style.color = C.green;
    const lowL = at(el("div", "lab-sm dim txt", L, `Lowest in the window €${F.dropNow}`), x + 300, y + 40 + 262);
    const bs = at(el("div", "lab dim txt", L, `paid, after the €${F.dropDeductible} deductible`), x + 150, y + 40 + 352);
    const rows = Rows(L, beat.bg, x, y + 500, [{ kind: "check", text: "Same flight, within the window", at: 6.4 }], { size: 40, font: 28 });
    rows.cues(beat);
    cueB(beat, 4.6, "coin");
    return (lt) => {
      rise(bl, lt, 1.0);
      ln.render(ease(seg(lt, 1.4, 4.0)));
      O(area, out3(seg(lt, 3.8, 4.6)));
      rise(lowL, lt, 3.9); rise(big, lt, 4.4, 0.7, 20); rise(bs, lt, 4.7);
      rows.render(lt);
    };
  });

  // 10 Flexible cover: date window and nearby airports.
  B.flex = feature("left", (L, beat, x, y) => {
    const lab = at(el("div", "lab dim txt", L, "Dates"), x, y + 6);
    const days = [11, 12, 13, 14, 15, 16, 17];
    const cells = days.map((d, i) => {
      const c = at(el("div", "", L), x + i * 82, y + 50, 70, 86);
      c.style.borderRadius = "35px";
      c.style.textAlign = "center";
      c.innerHTML = `<div class="lab-sm dim" style="margin-top:12px">Jun</div><div class="lab" style="font-weight:700">${d}</div>`;
      return { c, k: Math.abs(i - 3) };
    });
    const lab2 = at(el("div", "lab dim txt", L, "Airports"), x, y + 186);
    const aps = ["AMS", "RTM", "EIN"].map((a, i) => at(el("div", "h-sm txt", L, a), x + i * 130, y + 230));
    const arr = at(el("div", "h-sm txt", L, "→ BCN"), x + 400, y + 230);
    const rows = Rows(L, beat.bg, x, y + 340, [
      { kind: "check", text: "Pays against the cheapest fare", at: 6.0 },
      { kind: "check", text: "Up to three days either side", at: 6.6 },
    ], { gap: 76, size: 40, font: 29 });
    rows.cues(beat);
    cueB(beat, 2.4, "tick");
    cueB(beat, 4.2, "tick");
    return (lt) => {
      rise(lab, lt, 1.0);
      cells.forEach((o, i) => {
        rise(o.c, lt, 1.1 + i * 0.06, 0.5, 14);
        const on = seg(lt, 2.2 + o.k * 0.35, 2.6 + o.k * 0.35) * (o.k <= 3 ? 1 : 0);
        o.c.style.background = o.k === 0 ? C.yellow : `rgba(255,209,0,${r3(on * 0.28)})`;
        o.c.style.color = o.k === 0 ? C.onYellow : "#fff";
      });
      rise(lab2, lt, 3.6);
      aps.forEach((a, i) => { rise(a, lt, i === 0 ? 3.8 : 4.3 + i * 0.25, 0.6, 16); a.style.color = i === 0 ? "#fff" : C.yellow; });
      rise(arr, lt, 3.9);
      rows.render(lt);
    };
  });

  // 11 Travellers and return trips.
  B.travellers = feature("right", (L, beat, x, y) => {
    const ppl = ["Anna", "Bram"].map((n, i) => {
      const e = at(el("div", "", L, `${ICON.person(C.blue, 70)}<div class="lab" style="text-align:center;margin-top:4px">${n}</div>`), x + i * 130, y + 10);
      return e;
    });
    const more = at(el("div", "lab dim txt", L, "up to 9 travellers"), x + 280, y + 40);
    const legs = [["AMS → BCN", "14 June"], ["BCN → AMS", "21 June"]].map(([a, b], i) => at(el("div", "", L, `<span class="h-sm">${a}</span><span class="lab dim" style="margin-left:18px">${b}</span>`), x, y + 170 + i * 70));
    const rows = Rows(L, beat.bg, x, y + 340, [
      { kind: "check", text: "Bought as one", at: 4.2 },
      { kind: "check", text: "One booking claims both flights", at: 5.4 },
    ], { gap: 78, size: 40, font: 29 });
    rows.cues(beat);
    return (lt) => {
      ppl.forEach((p, i) => pop(p, lt, 1.0 + i * 0.3));
      rise(more, lt, 1.8);
      legs.forEach((l, i) => rise(l, lt, 2.4 + i * 0.4, 0.7, 18));
      rows.render(lt);
    };
  });

  // 12 Refunds and renewals.
  B.renew = feature("left", (L, beat, x, y) => {
    const lab = at(el("div", "lab dim txt", L, "Refundable ticket"), x, y + 6);
    const t1 = at(el("div", "lab txt", L, "Final check just before departure"), x, y + 46);
    const s = svgBox(L, x, y + 210, COLW, 200);
    const lab2 = at(el("div", "lab dim txt", L, "Renew a Price Cap"), x, y + 160);
    const b1 = sv("rect", s, { x: 0, y: 40, height: 56, width: 0, rx: 28, fill: C.lav });
    const b2 = sv("rect", s, { x: 300, y: 40, height: 56, width: 0, rx: 28, fill: C.yellow });
    const tx1 = sv("text", s, { x: 24, y: 76, "font-family": "Outfit", "font-weight": 600, "font-size": 24, fill: C.ink }); tx1.textContent = "Current lock";
    const tx2 = sv("text", s, { x: 324, y: 76, "font-family": "Outfit", "font-weight": 600, "font-size": 24, fill: C.onYellow }); tx2.textContent = "Renewal";
    const mark = sv("line", s, { x1: 300, y1: 20, x2: 300, y2: 116, stroke: "#fff", "stroke-width": 3 });
    const ml = sv("text", s, { x: 300, y: 150, "text-anchor": "middle", "font-family": "Atkinson Hyperlegible Next", "font-size": 22, fill: "#fff" }); ml.textContent = "starts the moment it ends";
    const rows = Rows(L, beat.bg, x, y + 420, [{ kind: "check", text: "No gap in cover", at: 7.0 }], { size: 40, font: 29 });
    rows.cues(beat);
    cueB(beat, 5.2, "land");
    return (lt) => {
      rise(lab, lt, 0.9); rise(t1, lt, 1.1);
      rise(lab2, lt, 3.6);
      A(b1, "width", r3(296 * out3(seg(lt, 4.0, 4.9))));
      A(b2, "width", r3(270 * out3(seg(lt, 5.0, 5.9))));
      O(tx1, seg(lt, 4.5, 4.9)); O(tx2, seg(lt, 5.5, 5.9));
      O(mark, seg(lt, 5.4, 5.8)); O(ml, seg(lt, 5.6, 6.1));
      rows.render(lt);
    };
  });

  // 13 Payout.
  B.payout = feature("right", (L, beat, x, y) => {
    const items = [
      [ICON.wallet(C.blue, 60), "Withdraw", "test USDC to your NEAR account", 1.2],
      [ICON.bank(C.blue, 60), "To a bank account", "through a simulated ramp", 3.4],
      [ICON.swap(C.blue, 60), "Another asset", "quoted with NEAR Intents", 5.8],
    ].map(([ic, t, sub, a], i) => {
      const e = at(el("div", "", L, `<div style="position:absolute;left:0;top:0">${ic}</div><div style="position:absolute;left:86px;top:2px;white-space:nowrap"><div class="lab" style="font-weight:600">${t}</div><div class="lab-sm dim">${sub}</div></div>`), x, y + 30 + i * 150, COLW, 120);
      return { e, a };
    });
    items.forEach((o) => cueB(beat, S(o.a), "tick"));
    return (lt) => items.forEach((o) => rise(o.e, lt, o.a, 0.7, 20));
  });

  // 14 LP vaults.
  B.lp = feature("left", (L, beat, x, y) => {
    const vs = [["Price Cap vault", 0.9], ["Drop Guarantee vault", 1.4]].map(([t, a], i) => {
      const e = at(el("div", "", L, `${ICON.vault(i ? C.lav : C.yellow, 80)}<div class="lab" style="margin-top:8px;white-space:nowrap">${t}</div>`), x + i * 300, y + 10);
      return { e, a };
    });
    const ep = svgBox(L, x, y + 200, 120, 120);
    sv("circle", ep, { cx: 60, cy: 60, r: 48, fill: "none", stroke: "rgba(255,255,255,.16)", "stroke-width": 10 });
    const arc = DrawLine(ep, "M60 12 A48 48 0 1 1 59.99 12", { stroke: C.yellow, "stroke-width": 10 });
    const el1 = at(el("div", "", L, `<div class="lab" style="font-weight:600">Deposits and withdrawals</div><div class="lab-sm dim">settle at each epoch</div>`), x + 150, y + 228);
    const rows = Rows(L, beat.bg, x, y + 380, [{ kind: "check", text: "Every policy fully collateralised", at: 6.4 }], { size: 40, font: 29 });
    rows.cues(beat);
    return (lt) => {
      vs.forEach((o) => pop(o.e, lt, o.a));
      O(ep, seg(lt, 3.0, 3.4));
      const q = (seg(lt, 3.2, 9.5) * 2.2) % 1;
      arc.render(q);
      O(arc.path, q > 0.02 ? 1 : 0);
      rise(el1, lt, 3.4);
      rows.render(lt);
    };
  });

  // 15 Transparency.
  B.transparency = feature("right", (L, beat, x, y) => {
    const rows = Rows(L, beat.bg, x, y + 20, [
      { kind: "check", text: "Parameters and formula", at: 1.4 },
      { kind: "check", text: "Collateral per vault", at: 2.4 },
      { kind: "check", text: "Recent prices", at: 3.4 },
      { kind: "info", text: "Service keys", sub: "development keys on testnet, labelled", at: 5.2 },
    ], { gap: 100, size: 44, font: 31 });
    rows.cues(beat);
    return (lt) => rows.render(lt);
  });

  // 16 Extras.
  B.extras = feature("left", (L, beat, x, y) => {
    const a = at(el("div", "", L, `<div style="position:absolute;left:0;top:0">${ICON.link(C.yellow, 64)}</div><div style="position:absolute;left:90px;top:4px;white-space:nowrap"><div class="lab" style="font-weight:600">Paste a link</div><div class="lab-sm dim">from any booking site</div></div>`), x, y + 30, COLW, 100);
    const b = at(el("div", "", L, `<div style="position:absolute;left:0;top:0">${ICON.eye(C.yellow, 64)}</div><div style="position:absolute;left:90px;top:4px;white-space:nowrap"><div class="lab" style="font-weight:600">Watch a price for free</div><div class="lab-sm dim">an alert when it moves</div></div>`), x, y + 190, COLW, 100);
    cueB(beat, 1.1, "tick");
    cueB(beat, 4.0, "tick");
    return (lt) => { rise(a, lt, 1.0, 0.7, 20); rise(b, lt, 3.9, 0.7, 20); };
  });

  // 17 How CapFare uses NEAR: one section per idea, started when the voice-over reaches it.
  B.near = (L, beat) => {
    const head = Headline(L, beat);
    const motif = Motif(L, "right");
    const secs = nearSections(L, beat);
    return (lt) => {
      head(lt);
      motif(lt);
      secs.forEach((s, k) => {
        const a = s.start, b = k + 1 < secs.length ? secs[k + 1].start : beat.dur + 2;
        const vis = lt >= a - 0.1 && lt < b + 0.5;
        V(s.root, vis);
        if (!vis) return;
        const fade = 1 - out3(seg(lt, b - 0.32, b + 0.06));
        O(s.root, fade);
        T(s.root, `translateY(${r3((1 - fade) * -24)}px)`);
        s.render(lt - a);
      });
    };
  };

  function nearSections(L, beat) {
    const E = window.EVIDENCE ?? {};
    const out = [];
    // In a recorded voice, NEP-141 is said right before the async calls: its receipts section covers both.
    const KEYS = [[/^Gasless$/, /^why$/i], [/^Accounts$/, /^readable$/], [/^Premiums,$/], [/^Every$/, /^NEP-141$/, /^async$/], [/^Price$/, /^ed25519$/], [/^And$/, /^All$/]];
    const starts = KEYS.map((ks) => { for (const re of ks) { const t = wordTime(beat, re); if (t != null) return Math.max(0.2, t - 0.3); } return null; });
    let k = -1;
    const sec = (fn) => {
      k += 1;
      if (starts[k] == null) return;
      // Sections are laid out from x = 330; shift them to line up with the headline.
      const root = at(el("div", "sec", L), -234, 0, W, H);
      const render = fn(root, k);
      out.push({ root, render, start: starts[k] });
    };
    const node = (root, x, y, w, h, title, sub, accent) => {
      const n = at(el("div", "card", root), x, y, w, h);
      n.innerHTML = `<div style="position:absolute;left:28px;top:22px;right:20px"><div class="lab" style="font-weight:650;${accent ? `color:${accent}` : ""}">${title}</div><div class="lab-sm dim" style="margin-top:6px">${sub}</div></div>`;
      return n;
    };
    const arrow = (svg, x1, y1, x2, y2, color = C.yellow) => {
      const ln = DrawLine(svg, `M${x1} ${y1} L${x2} ${y2}`, { stroke: color, "stroke-width": 4 });
      const hd = sv("path", svg, { d: `M${x2 - 14} ${y2 - 10} L${x2} ${y2} L${x2 - 14} ${y2 + 10}`, fill: "none", stroke: color, "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" });
      const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      hd.setAttribute("transform", `rotate(${ang} ${x2} ${y2})`);
      return { render(p) { ln.render(p); O(hd, seg(p, 0.85, 1)); } };
    };
    const ev = (root, x, y, w, html) => {
      const e = at(el("div", "code mono", root, html), x, y, w);
      return e;
    };
    const short = (h) => (h ? h.slice(0, 10) + "…" + h.slice(-6) : "");
    const abs = (k, lt) => beat.start + starts[k] + lt;

    // a. Gasless meta-transactions.
    sec((root) => {
      const s = svgBox(root, 0, 0, W, H);
      const n1 = node(root, 330, 300, 380, 130, "anna signs", "a meta-transaction (passkey)");
      const n2 = node(root, 800, 300, 400, 130, "CapFare relayer", "submits it and pays the gas", C.yellow);
      const n3 = node(root, 1290, 300, 480, 130, "registry.v2.capfare.testnet", "runs the call as anna");
      const a1 = arrow(s, 716, 365, 790, 365), a2 = arrow(s, 1206, 365, 1280, 365);
      const tx = E.metaTx;
      const e = ev(root, 330, 490, 1440, tx
        ? `<span class="c">// a real transaction on NEAR testnet (${tx.when ?? "today"})</span><br>tx <span class="f">${short(tx.hash)}</span>  signer <span class="s">${tx.signer}</span>  ·  inner signer <span class="s">${tx.inner}</span><br>action <span class="k">Delegate</span> → <span class="f">${tx.method}</span> on ${tx.receiver}  ·  gas paid by <span class="s">${tx.signer}</span>`
        : `<span class="c">// evidence pending</span>`);
      [0.3, 1.1, 1.9].forEach((d) => cue(abs(0, d), "land", 0.7));
      return (lt) => {
        rise(n1, lt, 0.2, 0.6, 20); a1.render(seg(lt, 0.8, 1.2)); rise(n2, lt, 1.0, 0.6, 20); a2.render(seg(lt, 1.6, 2.0)); rise(n3, lt, 1.8, 0.6, 20);
        rise(e, lt, 2.8, 0.7, 16);
      };
    });

    // b. Named accounts, created by the relayer.
    sec((root) => {
      const names = E.accounts ?? ["anna-devries.capfare.testnet", "annadv.capfare.testnet"];
      const big = at(el("div", "h-mid txt", root, `${names[0].split(".")[0]}<span style="color:${C.lav}">.capfare.testnet</span>`), 330, 310);
      big.style.fontSize = "76px";
      const s = at(el("div", "lab dim txt", root, "Readable accounts, created by the relayer for each new user"), 334, 420);
      const e = ev(root, 330, 500, 1100, E.accountView
        ? `<span class="c">// view_account and view_access_key_list on testnet RPC</span><br><span class="s">${E.accountView.id}</span>  ·  ${E.accountView.storage} bytes  ·  key <span class="k">${E.accountView.key}</span><br>a sub-account of <span class="f">${E.accountView.parent}</span>: only the relayer's account can create it`
        : `<span class="c">// evidence pending</span>`);
      cue(abs(1, 0.3), "land", 0.8);
      return (lt) => { rise(big, lt, 0.2, 0.8, 24); rise(s, lt, 0.8); rise(e, lt, 1.6, 0.7, 16); };
    });

    // c. NEP-141 ft_transfer_call.
    sec((root) => {
      const s = svgBox(root, 0, 0, W, H);
      const n1 = node(root, 330, 300, 420, 130, "Policy registry", "pays the premium");
      const n2 = node(root, 1250, 300, 420, 130, "Price Cap vault", "locks the max payout");
      const a = arrow(s, 756, 365, 1240, 365);
      const coin = sv("circle", s, { r: 18, fill: C.yellow, cx: 760, cy: 365 });
      const ml = at(el("div", "mono txt", root, `<span style="color:${C.yellow}">ft_transfer_call</span>(msg: "lock")`), 830, 400);
      const tok = at(el("div", "lab dim txt", root, "test USDC is a NEP-141 token: usdc.v2.capfare.testnet"), 334, 480);
      const e = ev(root, 330, 550, 1340, E.ftCall
        ? `<span class="c">// receipts of the same purchase</span><br><span class="s">${E.ftCall.from}</span> → <span class="s">${E.ftCall.token}</span>  <span class="f">ft_transfer_call</span><br>&nbsp;&nbsp;receiver_id <span class="s">${E.ftCall.vault}</span>, amount <span class="k">${E.ftCall.amount}</span> (${E.ftCall.tusdc} tUSDC)${E.ftCall.policy != null ? `, msg: policy <span class="k">${E.ftCall.policy}</span>` : ""}<br><span class="s">${E.ftCall.token}</span> → <span class="s">${E.ftCall.vault}</span>  <span class="f">ft_on_transfer</span>`
        : `<span class="c">// evidence pending</span>`);
      cue(abs(2, 1.2), "coin");
      return (lt) => {
        rise(n1, lt, 0.2, 0.6, 20); rise(n2, lt, 0.5, 0.6, 20);
        a.render(seg(lt, 0.9, 1.6));
        const q = ease(seg(lt, 1.0, 2.2));
        A(coin, "cx", r3(760 + q * 470)); O(coin, win(lt, 1.0, 2.4, 0.2, 0.25));
        rise(ml, lt, 1.4); rise(tok, lt, 2.0); rise(e, lt, 2.6, 0.7, 16);
      };
    });

    // d. Async cross-contract calls with a rollback callback.
    sec((root) => {
      const chain = E.receipts ?? [
        ["anna-devries.capfare.testnet", "registry.v2", "buy_caps"],
        ["registry.v2", "att.v2", "consume_snapshot"],
        ["registry.v2", "registry.v2", "on_cap_inputs"],
        ["registry.v2", "usdc.v2", "ft_transfer_call"],
        ["usdc.v2", "cap.v2", "ft_on_transfer"],
        ["registry.v2", "registry.v2", "on_policy_funded"],
      ];
      const lab = at(el("div", "lab dim txt", root, E.receipts ? "Receipts of one real purchase, in order" : "Receipts of a purchase"), 334, 270);
      const rows = chain.slice(0, 9).map(([from, to, m], i) => {
        const e = at(el("div", "mono txt", root, `<span style="color:${C.lav}">${from}</span>  →  <span style="color:#fff">${to}</span>  <span style="color:${C.yellow}">${m}</span>`), 334, 320 + i * 44);
        e.style.fontSize = "24px";
        return e;
      });
      const fail = at(el("div", "card", root), 1290, 330, 480, 250);
      fail.innerHTML = `<div style="position:absolute;left:30px;top:26px;right:24px"><div class="lab" style="font-weight:650">If a step fails</div><div class="lab-sm dim" style="margin-top:10px;white-space:normal">the callback rolls back: credit returned, exposure released, booking free to use again.</div></div>`;
      rows.forEach((_, i) => cue(abs(3, 0.6 + i * 0.55), "tick", 0.6));
      cue(abs(3, 5.0), "land");
      return (lt) => {
        rise(lab, lt, 0.2);
        rows.forEach((e, i) => rise(e, lt, 0.5 + i * 0.55, 0.5, 12));
        rise(fail, lt, 4.9, 0.7, 20);
      };
    });

    // e. ed25519 signatures checked on-chain.
    sec((root) => {
      const card = at(el("div", "card", root), 330, 290, 560, 300);
      const k = E.serviceKeys ?? [];
      card.innerHTML = `<div style="position:absolute;left:30px;top:26px;right:24px"><div class="lab" style="font-weight:650">Signed by the services</div><div class="lab-sm dim" style="margin-top:8px">price snapshots (oracle)<br>booking attestations (verifier)</div><div class="mono" style="margin-top:18px;color:${C.lav};font-size:19px">${k.map((x) => `${x.role}: ${x.key}`).join("<br>") || "ed25519 keys registered on-chain"}</div></div>`;
      const s = svgBox(root, 0, 0, W, H);
      const a = arrow(s, 900, 440, 990, 440);
      const code = ev(root, 1000, 290, 790, `<span class="c">// ${E.verifyFile ?? "contracts/attestation_registry/src/lib.rs"}</span><br><span class="k">if</span> !env::<span class="f">ed25519_verify</span>(<br>&nbsp;&nbsp;&nbsp;&nbsp;&amp;a.signature.0, &amp;attestation_digest(att), &amp;a.signer.0) {<br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">return</span> Err(<span class="s">"bad signature"</span>);<br>}`);
      code.style.fontSize = "19px";
      const ok = at(el("div", "", root), 1000, 520);
      const rows = Rows(ok, "ink", 0, 0, [{ kind: "check", text: "Checked by the contract, not trusted", at: 0 }], { size: 40, font: 28 });
      const t0 = 2.6;
      cue(abs(4, t0 + 0.15), "check");
      return (lt) => { rise(card, lt, 0.2, 0.7, 20); a.render(seg(lt, 1.0, 1.4)); rise(code, lt, 1.3, 0.7, 16); O(ok, lt > t0 ? 1 : 0); rows.render(lt - t0); };
    });

    // f. Everything on the public explorer.
    sec((root) => {
      const list = (E.contracts ?? ["registry.v2.capfare.testnet", "cap.v2.capfare.testnet", "drop.v2.capfare.testnet", "att.v2.capfare.testnet", "usdc.v2.capfare.testnet"]);
      const lab = at(el("div", "lab dim txt", root, "testnet.nearblocks.io/address/…"), 334, 290);
      const rows = list.map((a, i) => {
        const e = at(el("div", "h-sm txt", root, a), 334, 340 + i * 62);
        e.style.fontSize = "40px";
        return e;
      });
      rows.forEach((_, i) => cue(abs(5, 0.4 + i * 0.25), "tick", 0.5));
      return (lt) => { rise(lab, lt, 0.1); rows.forEach((e, i) => rise(e, lt, 0.35 + i * 0.25, 0.6, 14)); };
    });
    return out;
  }

  // Status: why I built it, and an honest testnet status (rows appear as they are said).
  B.status = (L, beat) => {
    const motif = Motif(L, "left");
    const why = beat.vo.some((v) => /^I built/.test(v.t));
    const q = MaskText(L, "h-mid", 96, 150, why ? "A flight price is the one thing on a trip you can't plan for." : "A testnet prototype.");
    q.el.style.width = "1060px";
    q.el.style.whiteSpace = "normal";
    q.el.style.fontSize = "60px";
    const tk = wordTime(beat, /^testnet$/) ?? 1;
    const k = at(el("div", "kicker", L, "Status"), 96, 470);
    k.style.top = "470px";
    const tw = (re, d) => (wordTime(beat, re) ?? d) - 0.1;
    const rows = Rows(L, beat.bg, 96, 530, [
      { kind: "check", text: "Live contracts on NEAR testnet", at: tw(/^live$/, tk + 1) },
      { kind: "info", text: "Demo prices, labelled as demo", at: tw(/^demo$/, tk + 2) },
    ], { gap: 96, size: 46, font: 34 });
    rows.cues(beat);
    return (lt) => { motif(lt); q.render(lt, 0.4, 0.06, 0.7); rise(k, lt, tk - 0.4); rows.render(lt); };
  };

  // End card.
  B.end = (L, beat) => {
    const g = at(el("div", "", L, logoMark(C.onYellow, 110)), 140, 300);
    const word = MaskText(L, "h-big txt", 300, 302, "CapFare");
    word.el.style.fontSize = "124px";
    const line = MaskText(L, "h-sm txt", 146, 470, "Built at the NEAR Hackathon");
    line.el.style.fontSize = "56px";
    const repo = at(el("div", "lab txt", L, "github.com/thomasdevving/capfare"), 150, 580);
    repo.style.fontSize = "34px";
    const site = at(el("div", "lab txt dim", L, `${HOST}  ·  NEAR testnet`), 150, 632);
    site.style.fontSize = "28px";
    cueB(beat, 0.3, "logo", 0.8);
    return (lt) => {
      rise(g, lt, 0.2, 0.8, 30);
      word.render(lt, 0.35, 0, 0.8);
      line.render(lt, 0.9, 0.05, 0.7);
      rise(repo, lt, 1.6); rise(site, lt, 1.9);
    };
  };

  // ---------- assemble ----------
  const layers = [];
  const camEl = el("div", "", stage);
  camEl.id = "cam";
  camEl.innerHTML = `<svg class="ic" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="22" r="11" fill="none" stroke="#d9cfff" stroke-width="3.5"/><path d="M12 56c2-11 10-17 20-17s18 6 20 17" fill="none" stroke="#d9cfff" stroke-width="3.5" stroke-linecap="round"/></svg><div class="lbl">WEBCAM</div><div class="sub">placeholder</div>`;
  const camIc = camEl.querySelector("svg"), camLbl = camEl.querySelector(".lbl"), camSub = camEl.querySelector(".sub");
  // The real webcam (X cut): frames extracted at 30 fps by video/voice/plan.py.
  const camImg = el("img", "camimg", camEl);
  const nameTag = el("div", "nametag", stage, `<b>Thomas</b><span>built CapFare</span>`);
  const capEl = el("div", "", stage);
  capEl.id = "cap";
  const band1 = el("div", "band", stage), band2 = el("div", "band", stage);
  const irisRing = el("div", "", stage);
  irisRing.id = "iris-ring";
  const fadeEl = el("div", "", stage);
  fadeEl.id = "fade";

  const TRANS = { logo: "iris", find: "wipe", account: "wipeR", credit: "iris", lock: "wipe", choices: "wipeR", alerts: "iris", claim: "wipe", verify: "wipeR", drop: "iris", flex: "wipe", travellers: "wipeR", renew: "iris", payout: "wipe", lp: "wipeR", transparency: "iris", extras: "wipe", near: "wipeR", status: "iris", end: "wipe" };
  const FOCUS = { logo: [490, 380], credit: [380, 420], alerts: [1520, 520], drop: [380, 420], renew: [1520, 520], transparency: [380, 500], status: [1520, 580] };
  const BG = { navy: C.navy, light: C.light, yellow: C.yellow, ink: C.ink };

  async function build() {
    const takes = new Set();
    for (const b of beats) for (const s of shotList(b.id)) takes.add(s.take);
    await Promise.all([...takes].map(loadTake));
    for (const b of beats) {
      const L = el("section", `beat ${b.bg}`, stage);
      L.dataset.id = b.id;
      const full = TIMELINE.BEATS.find((x) => x.id === b.id).dur;
      b.k = XV || ["near", "status"].includes(b.id) ? 1 : full / b.dur;
      const r0 = (B[b.id] ?? (() => () => {}))(L, b);
      const render = ["intro", "logo", "end"].includes(b.id) ? (lt) => r0(lt * b.k) : r0;
      const tr = b === beats[0] ? "fade" : TRANS[b.id] ?? "wipe";
      layers.push({ b, L, render, tr });
      if (tr !== "fade") cue(b.start - TR / 2 + (tr === "iris" ? 0.05 : 0.12), tr === "iris" ? "iris" : "wipe");
    }
    CUES.sort((a, b) => a.t - b.t);
  }

  // Caption chunks with absolute times.
  const VO = [];
  for (const b of beats) {
    for (const c of capsOf(b)) VO.push({ beat: b.id, start: r3(b.start + c.start), end: r3(b.start + c.end), text: c.text, cam: c.cam });
  }

  function camAt(t) {
    const i = beats.findIndex((b) => t < b.start + b.dur) ?? beats.length - 1;
    const b = beats[i < 0 ? beats.length - 1 : i];
    const res = [];
    for (const bb of [beats[i - 1], b, beats[i + 1]]) {
      if (!bb?.cam) continue;
      const lt = t - bb.start;
      if (bb.cam.src) {
        // Real webcam: visible from..to (scene seconds), lip-synced to the voice clip of the scene.
        const first = bb === beats[0];
        const o = first ? Math.min(1, win(lt, 0, bb.cam.to, 0.01, 0.4)) : win(lt, bb.cam.from - 0.15, bb.cam.to + 0.25, 0.4, 0.4);
        if (o <= 0) continue;
        const srcT = clamp(bb.cam.voiceIn + (lt - bb.cam.voiceAt), 0, bb.cam.voiceOut + (bb.id === "end" ? 3 : 0.5));
        const [x, y, w, h] = bb.cam.at;
        res.push({ beat: bb.id, x, y, w, h, round: !!bb.cam.round, kind: bb.cam.kind, opacity: r3(o), src: bb.cam.src, srcT: r3(srcT), lt });
        continue;
      }
      // A PiP limited to part of a scene stays up while the on-camera lines are said.
      const camLines = TIMELINE.captions(bb).filter((c) => c.cam);
      const from = bb.cam.from ?? 0;
      const to = bb.cam.to == null ? bb.dur : camLines.length ? camLines[camLines.length - 1].end + 0.35 : bb.cam.to;
      let o = win(lt, from + (from > 0 ? 0 : 0.25), to - (bb.cam.to != null ? 0 : 0.1), 0.5, 0.45);
      if (bb === beats[0] && bb.cam.from == null) o = Math.min(1, win(lt, 0, to - 0.1, 0.6, 0.45));
      if (o <= 0) continue;
      const [x, y, w, h] = bb.cam.at;
      res.push({ beat: bb.id, x, y, w, h, round: !!bb.cam.round, kind: bb.cam.kind, opacity: r3(o) });
    }
    return res[0] ?? null;
  }

  function renderCam(t) {
    const c = camAt(t);
    if (!c) { V(camEl, false); V(camImg, false); O(nameTag, 0); return; }
    V(camEl, true);
    at(camEl, c.x, c.y, c.w, c.h);
    camEl.style.borderRadius = c.round ? "50%" : "26px";
    const sc = 0.94 + 0.06 * out3(c.opacity);
    T(camEl, `scale(${r3(sc)})`);
    O(camEl, c.opacity);
    V(camImg, !!c.src);
    [camIc, camLbl, camSub].forEach((e) => O(e, c.src ? 0 : 1));
    camEl.classList.toggle("live", !!c.src);
    if (c.src) setSrc(camImg, `../out/cam/${c.src}/${String(Math.floor(c.srcT * 30) + 1).padStart(5, "0")}.jpg`);
    // Name in the opening, under the camera.
    const nt = c.src && c.beat === "intro" ? win(c.lt, 0.9, 4.6, 0.5, 0.5) : 0;
    O(nameTag, nt);
    T(nameTag, `translateY(${r3((1 - out3(Math.min(1, nt * 1.2))) * 14)}px)`);
    if (c.src) return;
    const small = c.w < 300;
    camIc.style.top = (c.h / 2 - (small ? 52 : 70)) + "px";
    camLbl.style.top = (c.h / 2 + (small ? 14 : 12)) + "px";
    camLbl.style.fontSize = (small ? 17 : 22) + "px";
    camSub.style.top = (c.h / 2 + (small ? 38 : 44)) + "px";
    O(camSub, !small || c.w > 200 ? 1 : 0);
  }

  function renderCaption(t) {
    const c = VO.find((v) => t >= v.start - 0.08 && t < v.end + 0.08);
    if (!c) { V(capEl, false); return; }
    V(capEl, true);
    if (capEl.__txt !== c.text) { capEl.textContent = c.text; capEl.__txt = c.text; }
    O(capEl, Math.min(seg(t, c.start - 0.08, c.start + 0.08), 1 - seg(t, c.end - 0.08, c.end + 0.08)) * 0.999 + 0.001);
  }

  function renderTransitions(t) {
    V(band1, false); V(band2, false); V(irisRing, false);
    for (let i = 1; i < layers.length; i++) {
      const { b, tr } = layers[i];
      const a0 = b.start - TR / 2, a1 = b.start + TR / 2;
      if (t < a0 || t > a1) continue;
      const p = (t - a0) / TR;
      if (tr === "wipe" || tr === "wipeR") {
        const dir = tr === "wipe" ? 1 : -1;
        const span = W + 2700 + 700;
        const x1 = -2700 - 350 + ease(p) * span;
        const x2 = -2700 - 350 + ease(clamp(p - 0.1, 0, 1) / 0.9) * span;
        const tx = (x) => (dir > 0 ? x : W - x - 2700);
        V(band1, true); V(band2, true);
        band1.style.background = b.bg === "yellow" ? C.navy : C.yellow;
        band2.style.background = BG[b.bg];
        T(band1, `translateX(${r3(tx(x1))}px) skewX(-16deg)`);
        T(band2, `translateX(${r3(tx(x2))}px) skewX(-16deg)`);
        // Band 2 covers the whole frame while x2 is in [-625, -155]: swap the scenes there.
        return { show: x2 > -390 ? [i] : [i - 1] };
      }
      if (tr === "iris") {
        const [cx, cy] = FOCUS[b.id] ?? [W / 2, H / 2];
        const r = 2300 * in3(clamp(p * 1.05)) * 0.35 + 2300 * ease(p) * 0.65;
        layers[i].L.style.clipPath = `circle(${r3(r)}px at ${cx}px ${cy}px)`;
        V(irisRing, true);
        at(irisRing, cx - r - 12, cy - r - 12, 2 * r + 24, 2 * r + 24);
        O(irisRing, 1 - seg(p, 0.75, 1));
        return { show: [i - 1, i], clip: i };
      }
    }
    return null;
  }

  async function renderFrame(t) {
    t = clamp(t, 0, duration - 1e-6);
    pending.length = 0;
    const tr = renderTransitions(t);
    let show;
    if (tr) show = tr.show;
    else {
      let i = layers.findIndex((l) => t < l.b.start + l.b.dur);
      if (i < 0) i = layers.length - 1;
      show = [i];
    }
    layers.forEach((l, i) => {
      const on = show.includes(i);
      V(l.L, on);
      if (!on) return;
      if (!(tr && tr.clip === i) && l.L.style.clipPath) l.L.style.clipPath = "";
      l.L.style.zIndex = i;
      l.render(t - l.b.start);
    });
    renderCam(t);
    renderCaption(t);
    // Fade in from black at the start, out to black at the end.
    O(fadeEl, Math.max(1 - seg(t, 0, 0.7), seg(t, duration - 0.8, duration)));
    await Promise.all(pending);
  }

  window.DURATION = duration;
  window.BEATS = beats.map((b) => ({ id: b.id, start: b.start, dur: b.dur, bg: b.bg, kicker: b.kicker, title: b.title }));
  window.VO = VO;
  window.CUES = CUES;
  window.camAt = camAt;
  window.renderFrame = renderFrame;
  (async () => {
    await Promise.all([document.fonts.load('650 60px "Outfit"'), document.fonts.load('500 30px "Atkinson Hyperlegible Next"'), document.fonts.load('700 30px "Atkinson Hyperlegible Next"')]);
    await document.fonts.ready;
    await build();
    const t = Number(QS.get("t"));
    if (QS.has("t")) await renderFrame(t);
    window.ready = true;
  })();
})();
