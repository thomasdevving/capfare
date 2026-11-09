/**
 * Captures real screenshots of the Chrome extension on the demo booking site (used on
 * the landing page and in docs). Requires the local stack (`stack --web`) and a built
 * extension (`CAPFARE_APP_URL=http://localhost:3000 pnpm --filter @capfare/extension build`).
 */
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_DIR } from "./config.ts";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? join(ROOT_DIR, "web/public/how");
const EXT = join(ROOT_DIR, "extension/build");

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "capfare-ext-")), {
  headless: true,
  channel: "chromium",
  viewport: { width: 1000, height: 750 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const page = await ctx.newPage();
// Start from the beginning of the scripted demo price path (€170 / €220).
for (const fare of ["economy_light", "economy_standard"]) {
  await fetch(`${APP}/api/demo/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flight_key: { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: fare }, to: 0 }),
  });
}
// Crop around the overlay and the page content next to it (4:3).
const CLIP = { x: 360, y: 280, width: 630, height: 472 };
async function shot(path: string, file: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.goto(`${APP}${path}`, { waitUntil: "load" });
  await page.waitForSelector("capfare-overlay", { timeout: 30_000, state: "attached" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, file), clip });
  console.log("saved", file);
}
const CLIP1 = process.env.CLIP1 ? JSON.parse(process.env.CLIP1) : undefined;
const CLIP2 = process.env.CLIP2 ? JSON.parse(process.env.CLIP2) : undefined;
await shot("/booker/results?from=AMS&to=BCN&date=2027-06-14&pax=1", "1-lock.png", CLIP1);
// A demo booking on Skyline Travel (demo) to show the confirmation-page offer.
const booking = (await (await fetch(`${APP}/api/booker/bookings`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fn: "KL1695", from: "AMS", to: "BCN", date: "2027-06-14", fare: "economy_standard", passengers: [{ title: "Ms", first: "Anna", last: "de Vries" }], email: "anna@example.org", card: "4242424242424242" }),
})).json()) as { ref: string; token: string };
await shot(`/booker/confirmation?ref=${booking.ref}&t=${booking.token}`, "2-book.png", CLIP2);
await shot(`/booker/manage?ref=${booking.ref}&t=${booking.token}`, "4-verify.png", CLIP2);
await ctx.close();
