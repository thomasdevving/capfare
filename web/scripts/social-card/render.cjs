/**
 * Renders the link-preview card to PNG:
 *   app/opengraph-image.png, app/twitter-image.png  1200x630 (Next serves these as og:image / twitter:image)
 *   docs/social-preview.png                           1280x640 (GitHub: Settings -> General -> Social preview)
 *
 *   node web/scripts/social-card/render.cjs
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const here = __dirname;
const web = path.join(here, "..", "..");
const url = (w, h) => `file://${path.join(here, "card.html")}?w=${w}&h=${h}`;

(async () => {
  const b = await chromium.launch();
  for (const [w, h, outs] of [
    [1200, 630, [path.join(web, "app", "opengraph-image.png"), path.join(web, "app", "twitter-image.png")]],
    [1280, 640, [path.join(web, "..", "docs", "social-preview.png")]],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(url(w, h));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const png = await p.screenshot({ type: "png" });
    for (const o of outs) fs.writeFileSync(o, png);
    console.log(`${w}x${h} -> ${outs.map((o) => path.relative(path.join(web, ".."), o)).join(", ")}`);
    await p.close();
  }
  await b.close();
})();
