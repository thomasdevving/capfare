/**
 * End-to-end on a demo deployment (local sandbox stack, `pnpm --filter @capfare/scripts stack -- --web`):
 * account → top-up (mock ramp) → quote → buy Price Cap → scripted price rise → claim with a
 * demo confirmation → payout. Also checks that the landing-page premium equals the contract view.
 */
import { expect, test } from "@playwright/test";
import { computePremium, type Params } from "@capfare/shared";
import { heroInputs, HERO } from "../lib/hero";

const FLIGHT = { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };

test("UI premium calculation equals the contract's preview_premium view", async ({ request }) => {
  const p = (await (await request.get("/api/params")).json()) as { params: Params };
  const cfg = await (await request.get("/api/overview")).json();
  for (const cap of [HERO.minCap, 18000, 20000, 23500, HERO.maxCap]) {
    const inputs = heroInputs(p.params, cap);
    const ui = computePremium(p.params.cap, inputs).premium;
    const args = Buffer.from(JSON.stringify({ inputs })).toString("base64");
    const r = await request.post("/api/rpc", {
      data: { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: cfg.contracts.registry, method_name: "preview_premium", args_base64: args } },
    });
    const j = await r.json();
    const onchain = JSON.parse(Buffer.from(j.result.result).toString());
    expect(ui, `cap ${cap}`).toBe(onchain.premium);
  }
});

test("quote → buy → claim → payout", async ({ page, request }) => {
  const name = `e2e${Date.now() % 1_000_000}`;
  await page.goto("/account");
  await page.getByLabel("Choose an account name").fill(name);
  await page.getByLabel(/Device key in this browser/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Signed in as`)).toBeVisible({ timeout: 30_000 });

  await page.goto("/credit");
  await page.getByRole("button", { name: /Top up €20/ }).click();
  await expect(page.getByText(/to your credit \(simulated iDEAL payment\)/)).toBeVisible({ timeout: 60_000 });

  // Reset the scripted price path to €170 for this flight.
  await request.post("/api/demo/advance", { data: { flight_key: FLIGHT, to: 0 } });

  await page.goto("/quote");
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page.getByText("Verified airline price")).toBeVisible({ timeout: 30_000 });
  await page.locator("#cap").fill("18000");
  await page.getByRole("button", { name: /^Lock €180 for/ }).click();
  await expect(page.getByText(/Protection #\d+ is active/)).toBeVisible({ timeout: 60_000 });
  const id = Number((await page.getByText(/Protection #\d+ is active/).innerText()).match(/#(\d+)/)![1]);

  // Activation delay (demo: 20 s), then the scripted price rises to €260.
  await page.waitForTimeout(22_000);
  for (const step of [1, 2, 3]) {
    const r = await request.post("/api/demo/advance", { data: { flight_key: FLIGHT, to: step } });
    expect(r.ok()).toBeTruthy();
    await page.waitForTimeout(1200);
  }

  await page.goto(`/claim/${id}`);
  await page.getByRole("tab", { name: "Demo confirmation" }).click();
  await page.getByLabel("Price you paid (€)").fill("255");
  await page.getByRole("button", { name: "Check my booking" }).click();
  await expect(page.getByText(/Payout: €70/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Paid to your account.")).toBeVisible();
  if (process.env.SAVE_SHOTS) {
    await page.setViewportSize({ width: 1000, height: 750 });
    const box = (await page.locator(".claim-result").boundingBox())!;
    const w = box.width, h = Math.max(box.height + 32, (w * 3) / 4);
    await page.screenshot({ path: "public/how/3-paid.png", clip: { x: box.x - 16, y: box.y - 16, width: w + 32, height: h }, scale: "device" });
  }
});
