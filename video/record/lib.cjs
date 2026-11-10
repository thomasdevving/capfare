/**
 * Recording helpers for the CapFare demo film.
 *
 * Each "take" records one browser tab with the Chrome DevTools screencast (not a screen recorder):
 * frames (1920x1200) are saved as footage/<take>/NNNNN.jpg with index.json [[secondsSinceStart, frameNo], ...]
 * and events.json [{t, type, label, x, y}] (clicks, typing, marks) so the film can sync
 * highlights and sound effects to what happens on screen.
 *
 * The page gets a visible cursor (SVG arrow following mousemove, shrinking on mousedown). The
 * mouse glides with eased steps, typing has a human delay, scrolling is an eased scrollTo loop.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const FOOTAGE = path.join(__dirname, "..", "footage");
const APP = process.env.APP_URL ?? "http://localhost:3000";
const EXT = path.join(ROOT, "extension", "build");
const VIEW = { width: 1440, height: 900 };

const CURSOR = `
(() => {
  if (window.__cursorInstalled) return; window.__cursorInstalled = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__rec_cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:34px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none;';
    c.innerHTML = '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M3 2 L3 26 L9.5 20 L14 31 L18.5 29 L14 18.5 L22.5 18.5 Z" fill="#0b1024" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    let x = -100, y = -100, s = 1;
    const put = () => { c.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px) scale(' + s + ')'; c.style.transformOrigin = '3px 2px'; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; put(); }, true);
    addEventListener('mousedown', () => { s = 0.82; put(); }, true);
    addEventListener('mouseup', () => { s = 1; put(); }, true);
    if (window.__lastMouse) { x = window.__lastMouse[0]; y = window.__lastMouse[1]; put(); }
  };
  if (document.documentElement) install(); else addEventListener('DOMContentLoaded', install);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function openBrowser(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: "chromium",
    viewport: VIEW,
    deviceScaleFactor: 4 / 3,
    acceptDownloads: true,
    // Headless screencast frames are in CSS pixels unless the device scale is forced at launch:
    // with it, frames come out at 1920x1200 (sharper zooms in the film).
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--hide-scrollbars", "--force-device-scale-factor=1.3333333"],
  });
  await ctx.addInitScript(CURSOR);
  return ctx;
}

class Take {
  constructor(ctx, page, name) {
    this.ctx = ctx;
    this.page = page;
    this.name = name;
    this.dir = path.join(FOOTAGE, name);
    this.events = [];
    this.index = [];
    this.mouse = [VIEW.width * 0.62, VIEW.height * 0.55];
  }
  get t() {
    return (Date.now() - this.t0) / 1000;
  }
  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.client = await this.ctx.newCDPSession(this.page);
    this.t0 = Date.now();
    let n = 0;
    let lastKept = -1;
    this.client.on("Page.screencastFrame", ({ data, sessionId }) => {
      this.client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const t = this.t;
      if (this.paused || t - lastKept < 1 / 30) return; // 30 fps is plenty for footage
      lastKept = t;
      n += 1;
      fs.writeFileSync(path.join(this.dir, `${String(n).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
      this.index.push([Number(t.toFixed(3)), n]);
    });
    await this.client.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
    await this.page.mouse.move(this.mouse[0], this.mouse[1]);
    this.mark("start");
  }
  mark(label, extra = {}) {
    this.events.push({ t: Number(this.t.toFixed(3)), type: "mark", label, ...extra });
    console.log(`  [${this.name} ${this.t.toFixed(1)}s] ${label}`);
  }
  async stop() {
    this.mark("end");
    await this.client.send("Page.stopScreencast").catch(() => {});
    fs.writeFileSync(path.join(this.dir, "index.json"), JSON.stringify(this.index));
    fs.writeFileSync(path.join(this.dir, "events.json"), JSON.stringify(this.events, null, 1));
    fs.writeFileSync(path.join(this.dir, "done"), new Date().toISOString());
  }
  /** Eased glide of the visible cursor to (x, y). */
  async moveTo(x, y, ms = 650) {
    const [x0, y0] = this.mouse;
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const p = easeInOut(i / steps);
      await this.page.mouse.move(x0 + (x - x0) * p, y0 + (y - y0) * p);
      await sleep(ms / steps);
    }
    this.mouse = [x, y];
    await this.page.evaluate(([a, b]) => (window.__lastMouse = [a, b]), [x, y]).catch(() => {});
  }
  async center(locator) {
    await locator.waitFor({ state: "visible", timeout: 120_000 });
    await this.ensureVisible(locator);
    const b = await locator.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2, b];
  }
  /** Scroll so the element sits comfortably in view (eased). */
  async ensureVisible(locator, margin = 140) {
    const b = await locator.boundingBox();
    if (!b) return;
    if (b.y >= margin && b.y + b.height <= VIEW.height - margin) return;
    const cur = await this.page.evaluate(() => scrollY);
    await this.scrollTo(Math.max(0, cur + b.y - VIEW.height * 0.4));
  }
  async scrollTo(y, ms = 900) {
    const from = await this.page.evaluate(() => scrollY);
    const steps = Math.max(10, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const p = easeInOut(i / steps);
      await this.page.evaluate((v) => window.scrollTo({ top: v, behavior: "instant" }), from + (y - from) * p);
      await sleep(ms / steps);
    }
  }
  async click(locator, label, opts = {}) {
    const [x, y] = await this.center(locator);
    await this.moveTo(x + (opts.dx ?? 0), y + (opts.dy ?? 0), opts.ms ?? 700);
    await sleep(opts.hover ?? 180);
    this.events.push({ t: Number(this.t.toFixed(3)), type: "click", label, x: x / VIEW.width, y: y / VIEW.height });
    console.log(`  [${this.name} ${this.t.toFixed(1)}s] click ${label}`);
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
    await sleep(opts.after ?? 350);
  }
  async clickAt(x, y, label, ms = 700) {
    await this.moveTo(x, y, ms);
    await sleep(180);
    this.events.push({ t: Number(this.t.toFixed(3)), type: "click", label, x: x / VIEW.width, y: y / VIEW.height });
    console.log(`  [${this.name} ${this.t.toFixed(1)}s] click ${label}`);
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
    await sleep(350);
  }
  async type(locator, text, label, delay = 55) {
    await this.click(locator, label ?? `field ${text}`);
    await locator.selectText().catch(() => {});
    await this.page.keyboard.press("Backspace").catch(() => {});
    this.events.push({ t: Number(this.t.toFixed(3)), type: "type", label: label ?? text });
    await this.page.keyboard.type(text, { delay });
    await sleep(250);
  }
  async hold(ms) {
    await sleep(ms);
  }
  /** Stop keeping frames during long waits (blockchain finality); the film cuts these out. */
  async idle(fn, label = "wait") {
    this.mark(`${label}:begin`);
    this.paused = true;
    try {
      return await fn();
    } finally {
      this.paused = false;
      // Force a fresh frame of the result (the screencast only sends frames on change).
      await this.page.mouse.move(this.mouse[0] + 1, this.mouse[1]).catch(() => {});
      await sleep(120);
      await this.page.mouse.move(this.mouse[0], this.mouse[1]).catch(() => {});
      this.mark(`${label}:end`);
    }
  }
}

async function take(ctx, name, fn, { reuse = false, page: given } = {}) {
  const dir = path.join(FOOTAGE, name);
  if (reuse && fs.existsSync(path.join(dir, "done"))) {
    console.log(`take ${name}: already recorded, skipping`);
    return null;
  }
  const page = given ?? (ctx.pages()[0] ?? (await ctx.newPage()));
  const tk = new Take(ctx, page, name);
  console.log(`take ${name}`);
  await tk.start();
  try {
    const r = await fn(tk, page);
    await tk.stop();
    return r;
  } catch (e) {
    await tk.stop().catch(() => {});
    fs.rmSync(path.join(dir, "done"), { force: true });
    await page.screenshot({ path: path.join(dir, "FAILED.png") }).catch(() => {});
    throw e;
  }
}

/** Finds the big yellow call-to-action of the extension overlay (closed shadow root) by its pixels. */
async function findOverlayCta(page) {
  const shot = await page.screenshot({ clip: { x: VIEW.width - 400, y: 0, width: 400, height: VIEW.height }, scale: "css" });
  const box = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const yellow = (i) => d[i] > 235 && d[i + 1] > 190 && d[i + 1] < 230 && d[i + 2] < 80;
    let rows = [];
    for (let y = 0; y < c.height; y++) {
      let run = 0, best = 0, end = 0;
      for (let x = 0; x < c.width; x++) {
        if (yellow((y * c.width + x) * 4)) { run++; if (run > best) { best = run; end = x; } } else run = 0;
      }
      if (best > 220) rows.push([y, end - best + 1, end]);
    }
    if (!rows.length) return null;
    // The CTA is the lowest wide yellow block.
    const last = rows[rows.length - 1][0];
    const block = rows.filter(([y]) => y > last - 70);
    const ys = block.map((r) => r[0]);
    return { x0: block[0][1], x1: block[0][2], y0: Math.min(...ys), y1: Math.max(...ys) };
  }, shot.toString("base64"));
  if (!box) return null;
  return [VIEW.width - 400 + (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
}

/**
 * Top edge of the extension overlay (a fixed 360 px box, 20 px from the bottom right) found by its
 * navy pixels, or null. Its close button sits 26 px below the top, 30 px in from the right edge.
 */
async function findOverlayTop(page) {
  const shot = await page.screenshot({ clip: { x: VIEW.width - 380, y: 0, width: 360, height: VIEW.height }, scale: "css" });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const navy = (x, y) => { const i = (y * c.width + x) * 4; return d[i] < 40 && d[i + 1] < 70 && d[i + 2] > 40 && d[i + 2] < 110; };
    // Below the page header: the first row where the box starts (navy now, not navy just above).
    for (let y = 160; y < c.height - 40; y++) {
      if (navy(60, y + 6) && navy(180, y + 6) && navy(300, y + 6) && navy(180, y + 30) && !navy(180, y - 6)) return y;
    }
    return null;
  }, shot.toString("base64"));
}

module.exports = { openBrowser, take, Take, sleep, APP, VIEW, FOOTAGE, ROOT, findOverlayCta, findOverlayTop };
