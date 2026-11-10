/**
 * End-to-end for travellers, return trips, route cover, the Drop option and alerts, on a demo
 * deployment (local sandbox stack). Prices move only through the demo controls.
 */
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { listFlights } from "@capfare/shared";

const OUT = { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };
// A model flight back from Barcelona a week later (the demo schedule is deterministic).
const backFlight = listFlights("BCN", "AMS", "2027-06-21")[0];
const BACK = { airline: backFlight.airline, flight_number: backFlight.flight_number, departure_date: "2027-06-21", origin: "BCN", destination: "AMS", fare_class: "economy_light" };

async function signUp(page: Page, prefix: string, topUps = 1) {
  await page.goto("/account");
  await page.getByLabel("Choose an account name").fill(`${prefix}${Date.now() % 1_000_000}`);
  await page.getByLabel(/Device key in this browser/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < topUps; i++) {
    await page.goto("/credit");
    await page.getByRole("button", { name: /Top up €20/ }).click();
    await expect(page.getByText(/to your credit/).first()).toBeVisible({ timeout: 60_000 });
  }
}

async function advance(request: APIRequestContext, data: Record<string, unknown>) {
  const r = await request.post("/api/demo/advance", { data });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test("return trip for two travellers: one booking claims both flights, Drop option adds Drop Guarantees", async ({ page, request }) => {
  test.setTimeout(240_000);
  await signUp(page, "e2et", 3);
  await advance(request, { flight_key: OUT, to: 0 });
  await advance(request, { flight_key: BACK, to: 0 });

  await page.goto(`/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&ret=2027-06-21&rfn=${BACK.flight_number}&pax=2`);
  await expect(page.getByRole("radio", { name: "Return" })).toBeChecked();
  await expect(page.getByLabel("Travellers")).toHaveValue("2");
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page.getByText(/Return trip AMS⇄BCN for 2 travellers/)).toBeVisible({ timeout: 30_000 });
  await page.locator("#cap").fill("18000");
  const backPrice = backFlight.fares[0].price_minor;
  await page.locator("#cap1").fill(String(Math.ceil(backPrice / 100) * 100));
  await page.getByLabel(/Lead passenger.s last name/).fill("Jansen");
  await page.getByText("Option: protect against a drop too").click();
  await page.getByRole("button", { name: /^Lock both flights for/ }).click();
  await expect(page.getByText(/Protections #\d+ and #\d+ are active/)).toBeVisible({ timeout: 60_000 });
  const [outId] = (await page.getByText(/Protections #\d+ and #\d+ are active/).innerText()).match(/\d+/g)!.map(Number);

  // Activation delay, then both flights get more expensive.
  await page.waitForTimeout(22_000);
  await advance(request, { flight_key: OUT, to: 3 });
  await advance(request, { flight_key: BACK, to: 3 });

  // Alerts: the policies page says to book now.
  await page.goto("/policies");
  await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/KL1695 AMS→BCN, 2027-06-14: €\d+ above your cap/)).toBeVisible();

  // Book the return trip for two on the demo booking site.
  const b = await (
    await request.post("/api/booker/bookings", {
      data: {
        fn: "KL1695", from: "AMS", to: "BCN", date: "2027-06-14", fare: "economy_light",
        ret: { fn: BACK.flight_number, origin: "BCN", destination: "AMS", date: "2027-06-21", fare: "economy_light" },
        passengers: [{ title: "Ms", first: "Anna", last: "Jansen" }, { title: "Mr", first: "Bram", last: "Jansen" }],
        email: "anna@example.org", card: "4242424242424242",
      },
    })
  ).json();

  await page.goto(`/claim/${outId}`);
  await expect(page.getByText(/This is a return trip/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Booking page link" }).click();
  await page.getByLabel(/Link to your booking/).fill(b.manage);
  await page.getByRole("button", { name: "Check my booking" }).click();
  // Outbound: (min(260, 260) - 180 - deductible) x 2 travellers; return leg paid too.
  await expect(page.getByText(/Payout: €\d+ \(2 travellers × €\d+\)/).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Payout: €\d+ \(2 travellers × €\d+\)/)).toHaveCount(2);
  await expect(page.locator(".claim-result caption")).toHaveCount(2);
  // Drop option chosen at purchase: Drop Guarantees are added with the same booking.
  await expect(page.getByText(/Drop Guarantees? #\d+( and #\d+)? active/)).toBeVisible({ timeout: 120_000 });

  await page.goto("/policies");
  await expect(page.getByText(/outbound of trip #\d+/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("article", { hasText: `Price Cap #${outId}` }).getByText("Paid out")).toBeVisible();
  await expect(page.locator("article", { hasText: "Drop Guarantee #" }).first().getByText("2 travellers")).toBeVisible();
});

test("route cover: any flight on the route and day, paid against the cheapest fare", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signUp(page, "e2er");
  const route = { origin: "AMS", destination: "BCN", departure_date: "2027-06-14", fare_class: "economy_light" };
  await advance(request, { route, to: 0 });
  await advance(request, { flight_key: OUT, to: 0 });

  await page.goto("/quote?scope=route&date=2027-06-14&from=AMS&to=BCN");
  await expect(page.getByRole("radio", { name: /Any flight on this route and day/ })).toBeChecked();
  await expect(page.locator("#fn")).toHaveCount(0);
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page.getByText("Cheapest verified fare on the route")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/flights in this route index/)).toBeVisible();
  const cheapest = Number((await page.locator(".quote-leg strong.num").first().innerText()).replace(/[^\d]/g, "")) * 100;
  await page.getByLabel(/Lead passenger.s last name/).fill("Visser");
  await page.getByRole("button", { name: /^Lock €\d+ for/ }).click();
  await expect(page.getByText(/Protection #\d+ is active/)).toBeVisible({ timeout: 60_000 });
  const id = Number((await page.getByText(/Protection #\d+ is active/).innerText()).match(/#(\d+)/)![1]);
  const p0 = await (await request.get(`/api/policies?id=${id}`)).json();
  expect("route" in p0.coverage).toBe(true);

  await page.waitForTimeout(22_000);
  await advance(request, { route, to: 3 }); // the whole route gets ~45% more expensive

  // Book whichever flight on the route: here not the cheapest one.
  const flights = listFlights("AMS", "BCN", "2027-06-14");
  const pick = flights.find((f) => f.flight_number !== "KL1695")!;
  const b = await (
    await request.post("/api/booker/bookings", {
      data: { fn: pick.flight_number, from: "AMS", to: "BCN", date: "2027-06-14", fare: "economy_light", passengers: [{ title: "Mr", first: "Tom", last: "Visser" }], email: "tom@example.org", card: "4242424242424242" },
    })
  ).json();
  await page.goto(`/verify#u=${encodeURIComponent(b.manage)}`);
  await page.getByRole("button", { name: "Verify booking" }).click();
  await expect(page.getByText("Booking verified")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: `Claim Price Cap #${id}` }).click();
  await expect(page.getByText(/Claim #\d+: done/)).toBeVisible({ timeout: 60_000 });
  const p = await (await request.get(`/api/policies?id=${id}`)).json();
  expect(p.booked_flight.flight_number).toBe(pick.flight_number);
  expect(p.index_at_booking_minor).toBeGreaterThan(cheapest);
  expect(p.payout_minor).toBe(Math.min(Math.min(p.index_at_booking_minor, p.paid_price_minor) - p.strike_minor - p.deductible_minor, p.max_payout_minor));
  expect(p.payout_minor).toBeGreaterThan(0);
});

test("alerts by email: double opt-in, then alerts arrive (demo outbox)", async ({ page, request }) => {
  test.setTimeout(150_000);
  await signUp(page, "e2ea");
  await advance(request, { flight_key: OUT, to: 0 });
  await page.goto("/quote");
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page.getByText("Verified airline price")).toBeVisible({ timeout: 30_000 });
  await page.locator("#cap").fill("18000");
  await page.getByLabel(/Lead passenger.s last name/).fill("Bakker");
  await page.getByRole("button", { name: /^Lock €180 for/ }).click();
  await expect(page.getByText(/Protection #\d+ is active/)).toBeVisible({ timeout: 60_000 });

  await page.goto("/policies");
  await page.getByText("Get alerts").click();
  await page.getByLabel("Email address").fill(`bakker${Date.now()}@example.org`);
  await page.getByRole("button", { name: "Send confirmation" }).click();
  await expect(page.getByText(/We sent a confirmation link/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/waiting for you to confirm/)).toBeVisible();
  // Demo outbox shows the confirmation mail; follow its link.
  await expect(page.getByText("Confirm your CapFare alerts")).toBeVisible({ timeout: 20_000 });
  const accountId = await page.evaluate(() => JSON.parse(localStorage.getItem("capfare.wallet.v1")!).accountId as string);
  const mails = await (await request.get(`/api/notify/outbox?account=${accountId}`)).json();
  const token = /token=([\w-]+)/.exec(mails[0].text)![1];
  await page.goto(`/notify/confirm?token=${token}`);
  await expect(page.getByText("Your email address is confirmed")).toBeVisible({ timeout: 20_000 });

  // The cap activates and the price rises: an alert email follows within a notifier tick.
  await page.waitForTimeout(22_000);
  await advance(request, { flight_key: OUT, to: 3 });
  await expect
    .poll(async () => ((await (await request.get(`/api/notify/outbox?account=${accountId}`)).json()) as { subject: string }[]).map((m) => m.subject).join("\n"), { timeout: 60_000, intervals: [3000] })
    .toMatch(/above your cap/);
});

test("paste a link from another booking site: the trip is filled in", async ({ page }) => {
  await page.goto("/quote");
  await page.getByLabel("Paste a link from any booking site").fill("Flights https://www.kayak.example/flights/AMS-BCN/2027-06-14/2027-06-21?adults=2");
  await expect(page.getByRole("status").filter({ hasText: "Found AMS → BCN · 14 Jun 2027 · return 21 Jun 2027 · 2 travellers." })).toBeVisible();
  await expect(page.getByLabel("Any flight on this route and day")).toBeChecked();
  await expect(page.getByLabel("Return", { exact: true })).toBeChecked();
  await expect(page.locator("#date")).toHaveValue("2027-06-14");
  // Shared to the installed web app: ?link=…
  await page.goto(`/quote?link=${encodeURIComponent("https://www.airline.example/search?flight=KL1695&outboundDate=2027-06-14&origin=AMS&destination=BCN")}`);
  await expect(page.locator("#fn")).toHaveValue("KL1695");
  await expect(page.getByLabel("This exact flight")).toBeChecked();
});

test("watch a price for free: alert by email when it rises (demo outbox)", async ({ page, request }) => {
  test.setTimeout(150_000);
  await signUp(page, "e2ew", 0);
  await advance(request, { flight_key: OUT, to: 0 });
  await page.goto("/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&fare=economy_light&watch=1");
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page.getByText("Verified airline price")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/Also tell me at or below/).fill("150");
  await page.getByRole("button", { name: "Watch the price" }).click();
  await expect(page.getByText(/Watching this price\. We'll tell you when it moves 10% or more or reaches €150/)).toBeVisible({ timeout: 30_000 });

  await page.goto("/policies");
  await page.getByText("Get alerts").click();
  await page.getByLabel("Email address").fill(`watch${Date.now()}@example.org`);
  await page.getByRole("button", { name: "Send confirmation" }).click();
  await expect(page.getByText("Confirm your CapFare alerts")).toBeVisible({ timeout: 20_000 });
  const accountId = await page.evaluate(() => JSON.parse(localStorage.getItem("capfare.wallet.v1")!).accountId as string);
  const mails = await (await request.get(`/api/notify/outbox?account=${accountId}`)).json();
  await page.goto(`/notify/confirm?token=${/token=([\w-]+)/.exec(mails[0].text)![1]}`);
  await expect(page.getByText("Your email address is confirmed")).toBeVisible({ timeout: 20_000 });

  await page.goto("/policies");
  await page.getByText("Watched prices").click();
  const row = page.getByRole("row", { name: /KL1695 AMS→BCN/ });
  await expect(row).toContainText("€170");
  await expect(row).toContainText("target €150");

  await advance(request, { flight_key: OUT, to: 3 });
  await expect
    .poll(async () => ((await (await request.get(`/api/notify/outbox?account=${accountId}`)).json()) as { subject: string }[]).map((m) => m.subject).join("\n"), { timeout: 60_000, intervals: [3000] })
    .toMatch(/KL1695 AMS→BCN, 2027-06-14: up €\d+ to €\d+/);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Nothing watched yet")).toBeVisible({ timeout: 20_000 });
});
