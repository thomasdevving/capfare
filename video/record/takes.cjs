/**
 * Records the real CapFare app (NEAR testnet, demo price source, Skyline Travel demo site,
 * Chrome extension) for the demo film. Run with the stack and web app up:
 *
 *   node video/record/takes.cjs            # all takes not recorded yet
 *   node video/record/takes.cjs claim lp   # just these (re-records them)
 *
 * State shared between takes (account, policy ids, downloaded emails) is kept in
 * footage/state.json, so takes can run in separate sessions.
 */
const fs = require("fs");
const path = require("path");
const { openBrowser, take, sleep, APP, FOOTAGE, findOverlayCta } = require("./lib.cjs");

const STATE = path.join(FOOTAGE, "state.json");
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const PROFILE = path.join(__dirname, "..", ".profile-main");
const PK_PROFILE = path.join(__dirname, "..", ".profile-passkey");

const OUT = { airline: "KL", flight_number: "KL1695", departure_date: "2027-06-14", origin: "AMS", destination: "BCN", fare_class: "economy_light" };
const fare = (fare_class) => ({ ...OUT, fare_class });
// The first demo-schedule flight back from Barcelona a week later (shared/src/demo-fares.ts listFlights).
const BACK = { airline: "IB", flight_number: "IB1131", departure_date: "2027-06-21", origin: "BCN", destination: "AMS", fare_class: "economy_light" };

async function api(p, body) {
  const r = await fetch(APP + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const t = await r.text();
  if (!r.ok) throw new Error(`${p}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const advance = (flight_key, to) => api("/api/demo/advance", { flight_key, to });

async function go(page, url, settle = 900) {
  await page.goto(APP + url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(settle);
}

/** Clicks the extension overlay's call to action and follows the link in this tab. */
async function clickOverlay(tk, page, label) {
  await page.waitForSelector("capfare-overlay", { state: "attached", timeout: 60_000 });
  await sleep(1800);
  const at = await findOverlayCta(page);
  if (!at) throw new Error("overlay call to action not found");
  const popup = tk.ctx.waitForEvent("page", { timeout: 15_000 });
  await tk.clickAt(at[0], at[1], label);
  const np = await popup;
  const url = np.url() === "about:blank" ? (await np.waitForURL(/http/), np.url()) : np.url();
  await np.close();
  await page.goto(url.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(700);
}

async function downloadLatestEml(tk, page, email, file) {
  await go(page, `/booker/inbox?email=${encodeURIComponent(email)}`);
  const link = page.getByRole("link", { name: "Download .eml" }).first();
  const dl = page.waitForEvent("download");
  await tk.click(link, "download .eml");
  const d = await dl;
  const p = path.join(FOOTAGE, file);
  await d.saveAs(p);
  return p;
}

async function skylineSearch(tk, page, { trip = "oneway", pax = 1 } = {}) {
  await go(page, "/booker");
  if (trip === "return") await tk.click(page.getByLabel("Return"), "return trip");
  await tk.click(page.locator('select[name="from"]'), "from");
  await page.locator('select[name="from"]').selectOption("AMS");
  await tk.click(page.locator('select[name="to"]'), "to");
  await page.locator('select[name="to"]').selectOption("BCN");
  await tk.click(page.locator('input[name="date"]'), "date");
  await page.locator('input[name="date"]').fill("2027-06-14");
  if (trip === "return") await page.locator('input[name="ret"]').fill("2027-06-21");
  if (pax > 1) {
    await tk.click(page.locator('select[name="pax"]'), "travellers");
    await page.locator('select[name="pax"]').selectOption(String(pax));
  }
  await tk.click(page.getByRole("button", { name: "Search" }), "search");
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(800);
}

/** Books on Skyline Travel through its UI from a results page; returns the confirmation URL. */
async function skylineBook(tk, page, { fn, fareName, pax = [["Ms", "Anna", "de Vries"]], email, retFn, retFareName }) {
  const card = page.locator(".sk-flight").filter({ hasText: fn.replace(/(\D+)(\d+)/, "$1 $2") }).or(page.locator(".sk-flight").filter({ hasText: fn }));
  await tk.click(card.first().getByRole("link", { name: "See fares" }), `see fares ${fn}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(700);
  await tk.click(page.locator(".sk-fare").filter({ hasText: fareName }).getByRole("link", { name: "Select" }), `select ${fareName}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(700);
  if (retFn) {
    const rc = page.locator(".sk-flight").filter({ hasText: retFn });
    if (await rc.count()) {
      await tk.click(rc.first().getByRole("link", { name: "See fares" }), `see fares ${retFn}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(600);
    }
    await tk.click(page.locator(".sk-fare").filter({ hasText: retFareName }).getByRole("link", { name: "Select" }), `select return ${retFareName}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(700);
  }
  for (let i = 0; i < pax.length; i++) {
    await page.locator(`#t${i}`).selectOption(pax[i][0]);
    await tk.type(page.locator(`#f${i}`), pax[i][1], `first name ${i}`, 45);
    await tk.type(page.locator(`#l${i}`), pax[i][2], `last name ${i}`, 45);
  }
  await tk.type(page.locator("#email"), email, "email", 30);
  await tk.type(page.locator("#card"), "4242 4242 4242 4242", "card", 25);
  await tk.type(page.locator("#exp"), "12/29", "expiry", 40);
  await tk.type(page.locator("#cvc"), "123", "cvc", 40);
  await tk.click(page.getByRole("button", { name: /^Pay / }), "pay");
  await tk.idle(() => page.waitForURL(/confirmation/, { timeout: 60_000 }), "booking");
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(600);
  return page.url();
}

async function buyCapOnQuote(tk, page, { cap = 18000, last = "de Vries", dropOption = false, label = "lock" }) {
  await tk.click(page.getByRole("button", { name: "Get a quote" }), "get a quote");
  await tk.idle(() => page.getByText(/Verified airline price|Cheapest verified fare/).first().waitFor({ timeout: 90_000 }), "quote");
  await sleep(900);
  const slider = page.locator("#cap");
  if (await slider.count()) {
    await tk.click(slider, "cap slider");
    await slider.fill(String(cap));
    await sleep(500);
  }
  await tk.type(page.getByLabel(/Lead passenger.s last name/), last, "last name");
  if (dropOption) await tk.click(page.getByText("Option: protect against a drop too."), "drop option");
  await tk.click(page.getByRole("button", { name: /^Lock / }), label);
  await tk.idle(() => page.getByText(/Protection(s)? #\d+/).first().waitFor({ timeout: 180_000 }), "buy");
  await sleep(2500);
  const txt = await page.getByText(/Protection(s)? #\d+/).first().innerText();
  return [...txt.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

async function topUp(page) {
  await go(page, "/credit", 300);
  await page.getByRole("button", { name: /Top up €20/ }).click();
  await page.getByText(/to your credit/).first().waitFor({ timeout: 120_000 });
  await sleep(500);
}

const TAKES = {
  /** Landing page: hero chart, then the section links glide. */
  async landing(ctx) {
    await take(ctx, "landing", async (tk, page) => {
      await go(page, "/", 1500);
      const slider = page.getByRole("slider").first();
      if (await slider.count()) {
        const [x, y, b] = await tk.center(slider);
        await tk.moveTo(b.x + b.width * 0.35, y);
        await page.mouse.down();
        await tk.moveTo(b.x + b.width * 0.62, y, 1400);
        await sleep(500);
        await tk.moveTo(b.x + b.width * 0.45, y, 1100);
        await page.mouse.up();
        tk.mark("cap dragged");
      }
      await sleep(800);
      for (const n of ["How it works", "Protection", "Your payout", "FAQ"]) {
        await tk.click(page.locator("nav a.anchor", { hasText: n }), `nav ${n}`, { after: 1900 });
        if (n !== "FAQ") await tk.scrollTo(0, 600);
      }
    });
  },

  /** Account with a real passkey (virtual authenticator), then a top-up signed with it. */
  async account() {
    fs.rmSync(PK_PROFILE, { recursive: true, force: true });
    const ctx = await openBrowser(PK_PROFILE);
    try {
      const page = ctx.pages()[0];
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
      await take(ctx, "account", async (tk) => {
        await go(page, "/account");
        await tk.type(page.getByLabel("Choose an account name"), state.pkName ?? "anna", "account name", 110);
        await tk.click(page.getByLabel(/Passkey/), "passkey");
        await tk.click(page.getByRole("button", { name: "Create account" }), "create account");
        await tk.idle(() => page.getByText("Signed in as").waitFor({ timeout: 120_000 }), "create");
        await sleep(2500);
        state.pkAccount = (await page.locator("main").innerText()).match(/Signed in as\s+(\S+)/)?.[1];
        save();
      });
      await take(ctx, "topup", async (tk) => {
        await go(page, "/credit");
        await tk.click(page.getByRole("button", { name: /Top up €20/ }), "top up");
        await tk.idle(() => page.getByText(/to your credit/).first().waitFor({ timeout: 120_000 }), "topup");
        await sleep(1500);
        await page.reload();
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(2500);
      });
    } finally {
      await ctx.close();
    }
  },

  /** Device-key account used for the rest of the story (survives browser restarts). */
  async setup(ctx) {
    const page = ctx.pages()[0];
    if (!state.main) {
      await go(page, "/account");
      await page.getByLabel("Choose an account name").fill(state.mainName ?? "anna-de-vries");
      await page.getByLabel(/Device key in this browser/).check();
      await page.getByRole("button", { name: "Create account" }).click();
      await page.getByText("Signed in as").waitFor({ timeout: 120_000 });
      state.main = (await page.locator("main").innerText()).match(/Signed in as\s+(\S+)/)?.[1];
      save();
    }
    for (let i = 0; i < 3; i++) await topUp(page);
    console.log("setup done", state.main);
  },

  /** Skyline search results: the extension offers a Price Cap; buy it in the web app. */
  async cap(ctx) {
    await advance(OUT, 0);
    await take(ctx, "ext-search", async (tk, page) => {
      await skylineSearch(tk, page);
      await clickOverlay(tk, page, "lock this price");
      tk.mark("quote page");
    });
    const page = ctx.pages()[0];
    await take(ctx, "buy-cap", async (tk) => {
      await sleep(600);
      state.cap1 = (await buyCapOnQuote(tk, page, { dropOption: true }))[0];
      state.cap1At = Date.now();
      save();
    }, { page });
  },

  /** Alerts: email double opt-in, then the scripted price passes the cap. */
  async alerts(ctx) {
    await take(ctx, "alerts-setup", async (tk, page) => {
      await go(page, "/policies");
      await tk.click(page.getByText("Get alerts"), "get alerts");
      await sleep(1500);
      await tk.type(page.getByLabel("Email address"), "anna@example.org", "email");
      await tk.click(page.getByRole("button", { name: "Send confirmation" }), "send confirmation");
      await tk.idle(() => page.getByText("Confirm your CapFare alerts").waitFor({ timeout: 60_000 }), "mail");
      await sleep(1200);
      await tk.ensureVisible(page.getByText("Confirm your CapFare alerts"));
      await sleep(2000);
      const out = await api(`/api/notify/outbox?account=${encodeURIComponent(state.main)}`);
      const token = /token=([\w-]+)/.exec(out.find((m) => /Confirm/.test(m.subject)).text)[1];
      await go(page, `/notify/confirm?token=${token}`);
      await page.getByText("Your email address is confirmed").waitFor({ timeout: 30_000 });
      await sleep(2500);
    });
    // The cap must be active (20 s) and the hosted demo's oracle has refreshed it (once a minute).
    const wait = Math.max(0, (state.cap1At ?? 0) + 75_000 - Date.now());
    if (wait) await sleep(wait);
    await take(ctx, "price-rise", async (tk, page) => {
      await go(page, "/policies", 1500);
      const btn = page.getByRole("button", { name: /^Demo: next scripted price$/ }).first();
      for (let i = 0; i < 3; i++) {
        await tk.click(btn, `next price ${i + 1}`);
        await tk.idle(() => page.getByText("Done.").waitFor({ timeout: 90_000 }), "advance");
        await sleep(1200);
      }
      await tk.scrollTo(0, 700);
      await tk.idle(() => page.getByText(/above your cap/).first().waitFor({ timeout: 90_000 }), "alert");
      await sleep(3000);
      await tk.idle(async () => {
        for (let i = 0; i < 30; i++) {
          const out = await api(`/api/notify/outbox?account=${encodeURIComponent(state.main)}`);
          if (out.some((m) => /above your cap/.test(m.subject))) return;
          await sleep(3000);
        }
      }, "alert mail");
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
      await tk.click(page.getByText("Get alerts"), "open alerts");
      await sleep(1500);
      const mail = page.getByText(/above your cap/).last();
      await tk.ensureVisible(mail);
      await sleep(3500);
    });
  },

  /** Book KL1695 on Skyline at the risen price; the confirmation page offers a Drop Guarantee. */
  async book(ctx) {
    await take(ctx, "book", async (tk, page) => {
      await skylineSearch(tk, page);
      await sleep(1500);
      state.booking1 = await skylineBook(tk, page, { fn: "KL1695", fareName: "Economy Light", email: "anna@example.org" });
      save();
      await page.waitForSelector("capfare-overlay", { state: "attached", timeout: 60_000 }).catch(() => {});
      await sleep(3500);
      await tk.click(page.getByRole("link", { name: "Open the demo inbox" }), "open inbox");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1500);
      const link = page.getByRole("link", { name: "Download .eml" }).first();
      const dl = page.waitForEvent("download");
      await tk.click(link, "download .eml");
      const d = await dl;
      state.eml1 = path.join(FOOTAGE, "booking1.eml");
      await d.saveAs(state.eml1);
      save();
      await sleep(1200);
    });
  },

  /** Claim with the original email: DKIM-checked in the booking verifier, paid from the vault. */
  async claim(ctx) {
    await take(ctx, "claim", async (tk, page) => {
      await go(page, "/policies", 1200);
      const btn = page.getByRole("link", { name: "I booked: claim" }).first();
      if (await btn.count()) await tk.click(btn, "i booked: claim");
      else await go(page, `/claim/${state.cap1}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      await tk.click(page.getByRole("tab", { name: "Upload the email" }), "upload tab");
      const input = page.locator("#eml");
      await tk.click(input, "choose file", { after: 200 });
      await input.setInputFiles(state.eml1);
      await sleep(900);
      await tk.click(page.getByRole("button", { name: "Check my booking" }), "check my booking");
      await tk.idle(() => page.getByText(/Payout: €/).first().waitFor({ timeout: 240_000 }), "claim");
      await sleep(1500);
      await tk.ensureVisible(page.locator(".claim-result").first());
      await sleep(2500);
      await tk.idle(() => page.getByText(/Drop Guarantee #\d+ (added|active)/).first().waitFor({ timeout: 120_000 }).catch(() => {}), "drop option");
      await sleep(1000);
      await tk.scrollTo(await page.evaluate(() => document.body.scrollHeight), 1400);
      await sleep(3500);
    });
  },

  /** Verification refusals: an edited email, a forwarded email, and a booking already used. */
  async reject(ctx) {
    const page = ctx.pages()[0];
    await advance(OUT, 0);
    await go(page, "/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&fare=economy_light");
    const tk0 = { click: async (l) => l.click(), idle: async (f) => f(), type: async (l, t) => l.fill(t) };
    state.cap2 = (await buyCapOnQuote(tk0, page, {}))[0];
    save();
    const src = fs.readFileSync(state.eml1, "utf8");
    const edited = src.replace(/€\s?260/g, "€360").replace(/260\.00/g, "360.00");
    state.emlEdited = path.join(FOOTAGE, "booking1-edited.eml");
    fs.writeFileSync(state.emlEdited, edited === src ? src.replace(/Economy Light/, "Economy Flex") : edited);
    const hdrEnd = src.indexOf("\r\n\r\n") > 0 ? src.indexOf("\r\n\r\n") : src.indexOf("\n\n");
    const nl = src.includes("\r\n") ? "\r\n" : "\n";
    const fwd = `From: Anna de Vries <anna@example.org>${nl}To: claims@friend.example${nl}Subject: Fwd: Your Skyline Travel booking${nl}Date: ${new Date().toUTCString()}${nl}MIME-Version: 1.0${nl}Content-Type: text/plain; charset=utf-8${nl}${nl}---------- Forwarded message ---------${nl}${src.slice(hdrEnd).replace(/^\s+/, "")}`;
    state.emlForwarded = path.join(FOOTAGE, "booking1-forwarded.eml");
    fs.writeFileSync(state.emlForwarded, fwd);
    save();
    await sleep(25_000);
    await take(ctx, "reject", async (tk) => {
      await go(page, `/claim/${state.cap2}`, 1200);
      for (const [file, label] of [[state.emlEdited, "edited email"], [state.emlForwarded, "forwarded email"], [state.eml1, "used booking"]]) {
        await tk.click(page.getByRole("tab", { name: "Upload the email" }), "upload tab");
        const input = page.locator("#eml");
        await tk.click(input, `choose ${label}`, { after: 200 });
        await input.setInputFiles(file);
        await sleep(700);
        await tk.click(page.getByRole("button", { name: "Check my booking" }), `check ${label}`);
        await tk.idle(() => page.locator('[role="alert"], .msg.error, .msg-error').first().waitFor({ timeout: 180_000 }), label);
        await sleep(1200);
        await tk.ensureVisible(page.locator('[role="alert"], .msg.error, .msg-error').first());
        tk.mark(`rejected ${label}`);
        await sleep(3500);
      }
    });
  },

  /** Someone else's booking (different lead passenger), checked live from the booking page. */
  async binding(ctx) {
    const page = ctx.pages()[0];
    await advance(OUT, 3);
    const b = await api("/api/booker/bookings", { fn: "KL1695", from: "AMS", to: "BCN", date: "2027-06-14", fare: "economy_light", passengers: [{ title: "Ms", first: "Eva", last: "Smit" }], email: "eva@example.org", card: "4242424242424242" });
    state.evaManage = b.manage;
    save();
    await take(ctx, "binding", async (tk) => {
      await page.goto(b.manage.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await clickOverlay(tk, page, "verify with capfare");
      await tk.click(page.getByRole("button", { name: "Verify booking" }), "verify booking");
      await tk.idle(() => page.getByText("Booking verified").waitFor({ timeout: 120_000 }), "verify");
      await sleep(1800);
      await tk.click(page.getByRole("button", { name: `Claim Price Cap #${state.cap2}` }), "claim cap 2");
      await tk.idle(() => page.getByText(/another passenger/).waitFor({ timeout: 180_000 }), "binding");
      await sleep(1000);
      await tk.ensureVisible(page.getByText(/another passenger/));
      await sleep(3500);
    });
  },

  /** Route cover: any tracked flight on the route and day, against the cheapest fare. */
  async route(ctx) {
    await take(ctx, "route", async (tk, page) => {
      await go(page, "/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&fare=economy_light");
      await tk.click(page.getByLabel("Any flight on this route and day"), "route option");
      await sleep(1200);
      await tk.click(page.getByRole("button", { name: "Get a quote" }), "get a quote");
      await tk.idle(() => page.getByText(/Cheapest verified fare/).first().waitFor({ timeout: 120_000 }), "quote");
      await sleep(1200);
      const det = page.getByText(/flights in this route index/);
      await tk.click(det, "route index");
      await sleep(2500);
      await tk.type(page.getByLabel(/Lead passenger.s last name/), "de Vries", "last name");
      await tk.click(page.getByRole("button", { name: /^Lock / }), "lock route");
      await tk.idle(() => page.getByText(/Protection #\d+ is active/).first().waitFor({ timeout: 180_000 }), "buy");
      await sleep(3000);
    });
  },

  /** Return trip for two travellers, Drop option; later one live check claims both flights. */
  async returntrip(ctx) {
    await advance(OUT, 0);
    await advance(BACK, 0);
    await take(ctx, "return-buy", async (tk, page) => {
      await go(page, `/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&ret=2027-06-21&rfn=${BACK.flight_number}&pax=2`, 1200);
      await tk.ensureVisible(page.getByLabel("Travellers"));
      await sleep(1500);
      const ids = await buyCapOnQuote(tk, page, { cap: 18000, dropOption: true, label: "lock both" });
      state.ret = ids;
      state.retAt = Date.now();
      save();
    });
  },
  async returnclaim(ctx) {
    const wait = Math.max(0, (state.retAt ?? 0) + 75_000 - Date.now());
    if (wait) await sleep(wait);
    await advance(OUT, 3);
    await advance(BACK, 3);
    await take(ctx, "return-claim", async (tk, page) => {
      await skylineSearch(tk, page, { trip: "return", pax: 2 });
      await sleep(1500);
      const conf = await skylineBook(tk, page, {
        fn: "KL1695",
        fareName: "Economy Light",
        retFn: BACK.flight_number,
        retFareName: "Economy Light",
        pax: [["Ms", "Anna", "de Vries"], ["Mr", "Bram", "de Vries"]],
        email: "anna@example.org",
      });
      state.returnBooking = conf;
      save();
      await sleep(1500);
      await tk.click(page.getByRole("link", { name: "Manage booking" }), "manage booking");
      await page.waitForLoadState("networkidle").catch(() => {});
      await clickOverlay(tk, page, "verify with capfare");
      await tk.click(page.getByRole("button", { name: "Verify booking" }), "verify booking");
      await tk.idle(() => page.getByText("Booking verified").first().waitFor({ timeout: 180_000 }), "verify");
      await sleep(1500);
      const claim = page.getByRole("button", { name: /^Claim Price Cap #/ }).first();
      await tk.click(claim, "claim both");
      await tk.idle(() => page.getByText(/Payout: €\d+ \(2 travellers/).nth(1).waitFor({ timeout: 300_000 }), "claim");
      await sleep(1500);
      await tk.ensureVisible(page.getByText(/Payout: €\d+ \(2 travellers/).first());
      await sleep(2500);
      await tk.scrollTo(await page.evaluate(() => document.body.scrollHeight), 1400);
      await tk.idle(() => page.getByText(/Drop Guarantee/).last().waitFor({ timeout: 120_000 }).catch(() => {}), "drops");
      await sleep(3500);
    });
  },

  /** Drop Guarantee bought right after booking; the price drops inside the window; settle. */
  async drop(ctx) {
    await advance(fare("economy_standard"), 0);
    await take(ctx, "drop-buy", async (tk, page) => {
      await skylineSearch(tk, page);
      await sleep(1000);
      state.booking2 = await skylineBook(tk, page, { fn: "KL1695", fareName: "Economy Standard", email: "anna.drop@example.org" });
      save();
      await clickOverlay(tk, page, "add drop guarantee");
      await sleep(1000);
      state.eml2 = path.join(FOOTAGE, "booking2.eml");
      const msgs = await api(`/api/booker/inbox?email=${encodeURIComponent("anna.drop@example.org")}`);
      const latest = [...msgs].sort((x, y) => (y.date ?? 0) - (x.date ?? 0))[0];
      fs.writeFileSync(state.eml2, await (await fetch(`${APP}/api/booker/email/${latest.id}`)).text());
      save();
      await tk.click(page.getByRole("tab", { name: "Upload the email" }), "upload tab");
      const input = page.locator("#eml");
      await tk.click(input, "choose file", { after: 200 });
      await input.setInputFiles(state.eml2);
      await sleep(700);
      await tk.click(page.getByRole("button", { name: "Check my booking" }), "check my booking");
      await tk.idle(() => page.getByRole("button", { name: /^Add the Drop Guarantee for/ }).waitFor({ timeout: 240_000 }), "verify");
      await sleep(1800);
      await tk.click(page.getByRole("button", { name: /^Add the Drop Guarantee for/ }), "add drop");
      await tk.idle(() => page.getByText(/Protection #\d+ is active/).waitFor({ timeout: 180_000 }), "buy");
      state.drop1 = Number((await page.getByText(/Protection #\d+ is active/).innerText()).match(/#(\d+)/)[1]);
      state.drop1At = Date.now();
      save();
      await sleep(3000);
    });
  },
  async dropsettle(ctx) {
    await take(ctx, "drop-fall", async (tk, page) => {
      await go(page, `/policies#p${state.drop1}`, 1500);
      const card = page.locator(`#p${state.drop1}`);
      await tk.ensureVisible(card);
      for (let i = 0; i < 2; i++) {
        await tk.click(card.getByRole("button", { name: /^Demo: next scripted price/ }), `next price ${i + 1}`);
        await tk.idle(() => page.getByText("Done.").waitFor({ timeout: 90_000 }), "advance");
        await sleep(1500);
      }
      await sleep(2500);
    });
    const wait = Math.max(0, (state.drop1At ?? 0) + 100_000 - Date.now());
    if (wait) await sleep(wait);
    await take(ctx, "drop-settle", async (tk, page) => {
      await go(page, `/claim/${state.drop1}`, 1500);
      await tk.click(page.getByRole("tab", { name: "Upload the email" }), "upload tab");
      const input = page.locator("#eml");
      await tk.click(input, "choose file", { after: 200 });
      await input.setInputFiles(state.eml2);
      await sleep(700);
      await tk.click(page.getByRole("button", { name: "Check my booking" }), "settle");
      await tk.idle(() => page.getByText(/Payout: €|paid|Paid/).first().waitFor({ timeout: 240_000 }), "settle");
      await sleep(1500);
      await tk.ensureVisible(page.locator(".claim-result").first());
      await sleep(3500);
    });
  },

  /** Refundable ticket: the claim is approved but held until a live check before departure. */
  async held(ctx) {
    const page = ctx.pages()[0];
    await advance(fare("economy_flex"), 0);
    await go(page, "/quote?fn=KL1695&date=2027-06-14&from=AMS&to=BCN&fare=economy_flex");
    const tk0 = { click: async (l) => l.click(), idle: async (f) => f(), type: async (l, t) => l.fill(t) };
    const ids = await buyCapOnQuote(tk0, page, { cap: 33500 });
    state.flexCap = ids[0];
    save();
    await sleep(75_000);
    await advance(fare("economy_flex"), 3);
    await sleep(2000);
    const b = await api("/api/booker/bookings", { fn: "KL1695", from: "AMS", to: "BCN", date: "2027-06-14", fare: "economy_flex", passengers: [{ title: "Ms", first: "Anna", last: "de Vries" }], email: "anna.flex@example.org", card: "4242424242424242" });
    state.flexManage = b.manage;
    save();
    await take(ctx, "held", async (tk) => {
      await page.goto(b.manage.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await clickOverlay(tk, page, "verify with capfare");
      await tk.click(page.getByRole("button", { name: "Verify booking" }), "verify booking");
      await tk.idle(() => page.getByText("Booking verified").first().waitFor({ timeout: 180_000 }), "verify");
      await sleep(1200);
      await tk.click(page.getByRole("button", { name: `Claim Price Cap #${state.flexCap}` }), "claim flex");
      await tk.idle(() => page.getByText(/final check|held|approved/i).first().waitFor({ timeout: 240_000 }), "claim");
      await sleep(3000);
      await go(page, `/policies#p${state.flexCap}`, 1500);
      await tk.ensureVisible(page.locator(`#p${state.flexCap}`));
      await sleep(3500);
      await tk.scrollTo(0, 900);
      await sleep(3000);
    });
  },

  /** Credit out: withdraw, simulated IBAN payout, NEAR Intents dry-run quote. */
  async creditout(ctx) {
    await take(ctx, "credit-out", async (tk, page) => {
      await go(page, "/credit", 1500);
      await tk.type(page.getByLabel("Unused credit to your wallet (tUSDC)"), "10", "withdraw amount");
      await tk.click(page.getByRole("button", { name: "Withdraw credit" }), "withdraw credit");
      await tk.idle(() => page.getByText(/Done|withdrawn|to your wallet/i).first().waitFor({ timeout: 120_000 }).catch(() => {}), "withdraw");
      await sleep(2000);
      await tk.type(page.getByLabel("To your bank account (IBAN)"), "NL91 ABNA 0417 1643 00", "iban", 40);
      await tk.type(page.getByLabel("Amount (tUSDC)"), "5", "iban amount");
      await tk.click(page.getByRole("button", { name: "Pay out to IBAN (simulated)" }), "iban payout");
      await tk.idle(() => page.getByText(/IBAN|simulated|on its way/i).last().waitFor({ timeout: 120_000 }).catch(() => {}), "iban");
      await sleep(2500);
      await tk.ensureVisible(page.getByRole("button", { name: "Get a dry quote" }));
      await tk.click(page.getByLabel("Receive as"), "receive as");
      const opts = await page.getByLabel("Receive as").locator("option").allTextContents();
      const pick = opts.find((o) => /USDC.*(Base|Arbitrum|Ethereum)|BTC|SOL/i.test(o)) ?? opts[1] ?? opts[0];
      await page.getByLabel("Receive as").selectOption({ label: pick });
      await sleep(600);
      await tk.click(page.getByRole("button", { name: "Get a dry quote" }), "dry quote");
      await tk.idle(() => page.getByText(/You would receive|would receive|dry/i).last().waitFor({ timeout: 60_000 }).catch(() => {}), "intents");
      await sleep(4000);
    });
  },

  /** Liquidity providers: deposit, epochs, withdrawal, both vaults. */
  async lp(ctx) {
    const page = ctx.pages()[0];
    await go(page, "/credit", 300);
    await page.getByRole("button", { name: "Faucet" }).click();
    await sleep(20_000);
    await take(ctx, "lp", async (tk) => {
      await go(page, "/lp", 1800);
      await tk.scrollTo(300, 1200);
      await sleep(1500);
      await tk.type(page.getByLabel(/Deposit \(tUSDC/), "50", "deposit amount");
      await tk.click(page.getByRole("button", { name: "Queue deposit" }), "queue deposit");
      await tk.idle(() => page.getByText(/Done|queued|Deposit/i).last().waitFor({ timeout: 120_000 }).catch(() => {}), "deposit");
      await sleep(2000);
      await tk.idle(() => sleep(32_000), "epoch");
      await tk.click(page.getByRole("button", { name: "Roll epoch (anyone can)" }), "roll epoch");
      await tk.idle(() => sleep(15_000), "roll");
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1500);
      await tk.ensureVisible(page.getByText("Your position"));
      await sleep(2500);
      await tk.type(page.getByLabel(/Withdraw \(% of your shares\)/), "50", "withdraw pct");
      await tk.click(page.getByRole("button", { name: "Request withdrawal" }), "request withdrawal");
      await tk.idle(() => sleep(15_000), "request");
      await sleep(1500);
      await tk.scrollTo(0, 1200);
      await tk.click(page.getByRole("button", { name: "Drop Guarantee vault" }), "drop vault");
      await sleep(3000);
      await tk.click(page.getByRole("button", { name: "Price Cap vault" }), "cap vault");
      await sleep(2500);
    });
  },

  /** Transparency: collateral, formulas, parameters, keys (development keys labelled), freshness. */
  async transparency(ctx) {
    await take(ctx, "transparency", async (tk, page) => {
      await go(page, "/transparency", 2500);
      await sleep(1500);
      const h = await page.evaluate(() => document.body.scrollHeight);
      for (const y of [520, 1400, Math.max(0, h - 2200), Math.max(0, h - 1300)]) {
        await tk.scrollTo(y, 1500);
        await sleep(2600);
      }
      const keys = page.getByText("Registered service keys");
      await tk.ensureVisible(keys);
      await sleep(3500);
    });
  },

  /** Newer extras: paste a link from any booking site, watch a price for free, extension popup. */
  async extras(ctx) {
    await take(ctx, "extras", async (tk, page) => {
      await go(page, "/quote", 1200);
      await tk.click(page.getByLabel("Paste a link from any booking site"), "paste field");
      await page.getByLabel("Paste a link from any booking site").fill("https://www.google.com/travel/flights?tfs=CBwQAhoeEgoyMDI3LTA2LTE0agcIARIDQU1TcgcIARIDQkNOQAFIAXABggELCP___________wGYAQE");
      await sleep(2600);
      await tk.click(page.getByRole("button", { name: "Get a quote" }), "get a quote");
      await tk.idle(() => page.getByText(/Cheapest verified fare/).first().waitFor({ timeout: 120_000 }), "quote");
      await sleep(1000);
      const w = page.getByText("Not ready to lock it? Watch the price for free");
      await tk.ensureVisible(w);
      await sleep(1200);
      await tk.type(page.getByLabel(/Also tell me at or below/), "150", "target");
      await tk.click(page.getByRole("button", { name: "Watch the price" }), "watch");
      await tk.idle(() => page.getByText(/Watching this price/).waitFor({ timeout: 60_000 }), "watch");
      await sleep(3500);
    });
  },
};

const ORDER = ["landing", "account", "setup", "cap", "alerts", "book", "claim", "reject", "binding", "route", "returntrip", "drop", "dropsettle", "held", "returnclaim", "creditout", "lp", "transparency", "extras"];

(async () => {
  const want = process.argv.slice(2);
  const run = want.length ? want : ORDER;
  const ctx = await openBrowser(PROFILE);
  try {
    for (const name of run) {
      if (!TAKES[name]) throw new Error(`unknown take ${name}`);
      const doneMarker = path.join(FOOTAGE, `.${name}.done`);
      if (!want.length && fs.existsSync(doneMarker)) {
        console.log(`skip ${name} (done)`);
        continue;
      }
      const t0 = Date.now();
      await TAKES[name](ctx);
      fs.writeFileSync(doneMarker, new Date().toISOString());
      console.log(`== ${name} done in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } finally {
    await ctx.close();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
