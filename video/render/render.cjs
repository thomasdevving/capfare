/**
 * Renders the film to JPEG frames with Playwright (60 fps, several workers, resumable).
 *
 *   node video/render/render.cjs                 # full cut -> video/frames/full/f00000.jpg ...
 *   node video/render/render.cjs --cut x         # 2:20 cut for X -> video/frames/x/
 *   node video/render/render.cjs --times 3,12.5  # just these moments -> video/out/<cut>/stills/
 *   node video/render/render.cjs --sample 20     # 20 evenly spaced stills (contact sheet input)
 *
 * Resumable: a frame is skipped when its file exists and is a complete JPEG (SOI ... EOI);
 * frames are written to a temp name and renamed, so an interrupted run never leaves a half file.
 * Also writes video/out/<cut>/meta.json: beats, captions (VO timing), sound cues, webcam rects.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const CUT = opt("cut", "full");
const FPS = Number(opt("fps", 60));
const WORKERS = Number(opt("workers", 3));
const OUT = path.join(ROOT, "out", CUT);
const FRAMES = path.join(ROOT, "frames", CUT);
const QUALITY = Number(opt("quality", 94));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".css": "text/css", ".png": "image/png" };
function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^([/\\])+/, "");
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "cache-control": "max-age=3600" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

function completeJpeg(f) {
  try {
    const st = fs.statSync(f);
    if (st.size < 2000) return false;
    const fd = fs.openSync(f, "r");
    const a = Buffer.alloc(2), b = Buffer.alloc(2);
    fs.readSync(fd, a, 0, 2, 0);
    fs.readSync(fd, b, 0, 2, st.size - 2);
    fs.closeSync(fd);
    return a[0] === 0xff && a[1] === 0xd8 && b[0] === 0xff && b[1] === 0xd9;
  } catch {
    return false;
  }
}

async function openFilm(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(`${base}/film/film.html?cut=${CUT}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120_000 });
  return page;
}

async function shot(page, t, file) {
  await page.evaluate((tt) => window.renderFrame(tt), t);
  const tmp = file + ".tmp";
  await page.screenshot({ path: tmp, type: "jpeg", quality: QUALITY, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  fs.renameSync(tmp, file);
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-lcd-text", "--font-render-hinting=none"] });
  try {
    const first = await openFilm(browser, base);
    const meta = await first.evaluate(() => ({ duration: window.DURATION, beats: window.BEATS, vo: window.VO, cues: window.CUES }));
    // Webcam placeholder rects, sampled per frame and merged into segments.
    meta.cam = await first.evaluate((fps) => {
      const segs = [];
      const n = Math.ceil(window.DURATION * fps);
      let cur = null;
      for (let i = 0; i <= n; i++) {
        const t = Number((i / fps).toFixed(3));
        const c = window.camAt(i / fps);
        const key = c ? [c.beat, c.x, c.y, c.w, c.h, c.round].join("|") : null;
        if (key !== (cur ? cur.key : null)) {
          if (cur) segs.push(cur);
          cur = c ? { key, beat: c.beat, kind: c.kind, x: c.x, y: c.y, w: c.w, h: c.h, round: c.round, start: t, end: t, fullStart: null, fullEnd: null } : null;
        }
        if (cur) {
          cur.end = t;
          if (c.opacity >= 0.999) { if (cur.fullStart == null) cur.fullStart = t; cur.fullEnd = t; }
        }
      }
      if (cur) segs.push(cur);
      return segs.map(({ key, ...s }) => s);
    }, FPS);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ cut: CUT, fps: FPS, ...meta }, null, 1));
    console.log(`${CUT}: ${meta.duration.toFixed(2)} s, ${meta.cues.length} cues, ${meta.vo.length} caption chunks, ${meta.cam.length} webcam segments`);

    const times = opt("times") ? opt("times").split(",").map(Number) : opt("sample") ? Array.from({ length: Number(opt("sample")) }, (_, i) => ((i + 0.5) * meta.duration) / Number(opt("sample"))) : null;
    if (times) {
      const dir = path.join(OUT, "stills");
      fs.mkdirSync(dir, { recursive: true });
      for (const t of times) {
        const f = path.join(dir, `t${t.toFixed(2).padStart(7, "0")}.jpg`);
        await shot(first, t, f);
        console.log("still", f);
      }
      return;
    }

    fs.mkdirSync(FRAMES, { recursive: true });
    const total = Math.round(meta.duration * FPS);
    const todo = [];
    for (let i = 0; i < total; i++) {
      const f = path.join(FRAMES, `f${String(i).padStart(5, "0")}.jpg`);
      if (!completeJpeg(f)) todo.push(i);
    }
    console.log(`${total} frames, ${total - todo.length} already done, ${todo.length} to render with ${WORKERS} workers`);
    // Contiguous chunks per worker: neighbouring frames share footage images.
    const chunk = Math.ceil(todo.length / WORKERS);
    const pages = [first];
    for (let w = 1; w < WORKERS; w++) pages.push(await openFilm(browser, base));
    const t0 = Date.now();
    let done = 0;
    await Promise.all(
      pages.map(async (page, w) => {
        for (const i of todo.slice(w * chunk, (w + 1) * chunk)) {
          await shot(page, i / FPS, path.join(FRAMES, `f${String(i).padStart(5, "0")}.jpg`));
          done++;
          if (done % 300 === 0) {
            const el = (Date.now() - t0) / 1000;
            console.log(`  ${done}/${todo.length}  ${(done / el).toFixed(1)} fps  eta ${Math.round(((todo.length - done) * el) / done)} s`);
          }
        }
      }),
    );
    // Final check: every frame exists and is complete.
    const bad = [];
    for (let i = 0; i < total; i++) if (!completeJpeg(path.join(FRAMES, `f${String(i).padStart(5, "0")}.jpg`))) bad.push(i);
    if (bad.length) throw new Error(`${bad.length} frames missing or broken, e.g. ${bad.slice(0, 5)}: run again to resume`);
    console.log(`all ${total} frames ok in ${FRAMES}`);
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
