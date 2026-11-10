# CapFare

CapFare sells flight-price protection for **one exact flight, date, fare class and airport
pair**, or optionally for **any flight it tracks on a route and day**, wherever the traveller
books, for **up to 9 travellers on one booking** and for **both flights of a return trip**. A **Price Cap** (bought before booking) pays the
difference if the airline's price for that flight rises above your cap before you book. A
**Drop Guarantee** (bought right after booking) pays the difference if the price of the same
flight drops within 7 days. Payouts come from two independent, fully collateralised vaults on
NEAR funded by liquidity providers. Prices and bookings are checked by services built to run
in TEEs, so no personal data reaches CapFare's servers or the chain. Users get gasless named
accounts with a passkey and prepaid credit, and alerts in the app, by web push or by email when
the price passes their cap or something needs doing.

> **Testnet prototype.** No real money. CapFare is price protection, not insurance; a
> commercial launch would require a licensed insurer or other licensed partner (docs/LEGAL.md).

## 1. What is real, what is simulated, what does not exist yet

| Real (runs, tested) | Simulated / demo | Not built yet |
|---|---|---|
| Rust contracts: vault ×2, policy registry (premium engine, claims, credit), attestation registry; full collateralisation; epochs; nullifiers; timelocked params and keys; rollback of every failed transfer | Prices in demos come from a **scripted demo price source** (`source_id = "demo"`) | A live airline price adapter: airline terms forbid automated access (D12) |
| Sandbox integration tests incl. forced failures; property tests on payouts, premiums and vault invariants | Booking confirmations in demos are **synthetic DKIM-signed emails** (selector `capfare-fixture`) | Live manage-booking status checks for real airlines (D14) |
| Public premium formula identical in Rust, TS and Python (conformance vectors) | Services run with **development keys**, not inside a TDX enclave (dstack key provider is implemented, untested on hardware) | On-chain TDX quote verification (D11) |
| Booking verifier: DKIM/ARC checks, forwarded/modified mail rejection, template parsing, nullifiers, passenger binding, live booking-page checks, PII-free signed attestations | Fiat top-ups and IBAN payouts: `MockRampProvider` (no money moves) | Licensed ramp provider integration (skeleton only) |
| NEP-366 relayer (gasless), named accounts, passkey (WebAuthn PRF) or device keys | Test USDC (mock NEP-141 token) on demo deployments | Optional lending-market yield on idle vault funds (D20) |
| Web app (landing, quote, policies, claim, verify, credit, LP dashboard, transparency), Chrome extension with a fixture-tested adapter, Skyline Travel (demo) mock booking site with one-way and return trips | NEAR Intents: **dry-run quotes only** (Intents has no testnet) | Chrome Web Store listing |
| Travellers per policy, return trips bought and claimed together, route cover (cheapest fare on a route and day), opt-in Drop Guarantee after a claim, held-claim timeout (D28–D32) | Route index in demos built from the demo fare model and scripted paths | Backtest of route cover and multi-traveller selection (D30) |
| Alerts: shared alert engine, in-app list, notifier service with web push (VAPID) and email (SMTP, double opt-in), account-key-signed settings (D33) | Demo deployments keep alert emails in an outbox instead of sending them | Push delivery is not covered by automated tests (needs a browser push service) |
| Backtest: synthetic fare paths, buyer models, calibration, parameter export | **All backtest results are synthetic** (docs/PRICING.md) | Backtest on real historical fares |

Deployment: from the build environment the testnet faucet was not reachable, so the
reproducible demo runs on a **local NEAR sandbox** (every page shows "Network: Local
sandbox"). `scripts/src/deploy.ts` deploys the same code to testnet with a funded account.

## 2. Architecture and NEAR technologies

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

* **Smart contracts (Rust, near-sdk 5.30)** — `contracts/vault` (deployed as cap_vault and
  drop_vault), `contracts/policy_registry`, `contracts/attestation_registry`, shared pure logic
  in `contracts/core`. Anyone can verify collateral, parameters and payouts.
* **Async cross-contract calls with rollback callbacks** — premiums, payouts, refunds and
  withdrawals all restore state if a transfer or callback fails.
* **NEP-141** settlement token and `ft_transfer_call` for deposits, premiums and credit.
* **NEP-366 meta-transactions** via `relayer/` — users never hold NEAR or pay gas.
* **Named accounts** — `alice.<relayer>` created by the relayer.
* **`env::ed25519_verify`** — on-chain verification of enclave-signed snapshots/attestations.
* **NEAR Intents (1Click API)** — dry quotes for paying out in another asset.
* **TEE** — dstack (TDX) key provider, attestation report binding, off-chain quote check and
  timelocked on-chain key registration (Shade-Agent-style approved measurements).

## 3. Prerequisites and setup

* Node 22 and pnpm 10, Rust stable with `wasm32-unknown-unknown`, `cargo-near` 0.23
  (`cargo install cargo-near --locked`; needs `libudev-dev pkg-config` on Linux), Python 3.11+.

```bash
pnpm install
```

```bash
./scripts/build-contracts.sh
```

```bash
python3 -m venv backtest/.venv && backtest/.venv/bin/pip install -r backtest/requirements.txt
```

Prebuilt wasm files (with SHA-256 sums) are in `contracts/res/` so the demo also runs without
a Rust toolchain.

## 4. Do X → see Y

| Do | See |
|---|---|
| `cd contracts && cargo test --workspace --exclude capfare-integration-tests` | Unit, property (random vault action sequences) and conformance tests pass. |
| `make test-integration` | Sandbox lifecycle test: cap and drop payouts, double claim rejected, forged attestation rejected, failed payout rolled back then retried, failed premium funding refunded, sold-out refund, nullifier release, failed LP withdrawal restored, timelocked params, stale snapshot rejected. In containers that cannot raise the open-file limit, run `make shim` first. |
| `pnpm -r test` | TS conformance with Rust vectors, sealed boxes, DKIM fixtures (valid/modified/forwarded/wrong domain/unsigned), oracle, relayer policy, extension adapters, web hero maths. |
| `cd backtest && .venv/bin/python -m pytest -q` | Formula conformance and simulation tests. |
| `./scripts/demo.sh` | The section-13 scenario end to end on a local sandbox; ends with `DEMO OK` and both vault invariants OK. |
| `pnpm --filter @capfare/scripts stack -- --web` | Full stack: sandbox, contracts, oracle :8081, verifier :8082, relayer :8083, notifier :8084, web on http://localhost:3000. |
| Open http://localhost:3000/booker | **Skyline Travel (demo)**, a full mock booking site: search, filters, fares, passengers, test-card payment, confirmation, My trips (manage/cancel) and a demo inbox with DKIM-signed `.eml` files. |
| `CAPFARE_APP_URL=http://localhost:3000 pnpm --filter @capfare/extension build`, then Chrome → Extensions → Developer mode → Load unpacked → `extension/build` | On Skyline search results the overlay offers a cap; on the confirmation page a Drop Guarantee; on the manage-booking page **Verify with CapFare**. |
| Book a flight on Skyline, then press **Verify with CapFare** on its manage page (or paste the link at /verify) | CapFare's checker loads the page from the booking site and shows "Booking verified", then offers to claim your cap. A booking for a different lead passenger is refused. |
| Web: **Account** → create with passkey (or device key) | A named account `name.sandbox` is created by the relayer; no gas needed. |
| Web: **Credit** → "Top up €20 (simulated iDEAL)" | 21.60 tUSDC credit (rate 1.08 USDC/EUR). |
| Web: **Check a flight** → KL1695, 2027-06-14, AMS→BCN, Economy Light → Get a quote → Lock | Premium from the public formula; policy active; max payout locked in cap_vault. |
| Web: **Policies** → wait for activation → "Demo: next scripted price" ×3 | Airline price €260 (scripted). |
| Web: **Claim** → Demo confirmation → paid €255 → Check my booking | Payout €70 = min(260, 255) − 180 − 5, paid to your wallet. |
| Web: **Transparency** | Parameters, pending changes, enclave keys, oracle freshness, collateral check. |
| Web: **LP** | Vault state, share price per epoch, exposure by flight and route-week, deposit/withdraw. |
| Web: **Check a flight** → Return, Travellers 2, return flight number → Get a quote → tick "Option: protect against a drop too" → Lock both flights | Two Price Caps (one trip) for two travellers; premiums, locks and max payouts are per traveller × 2. |
| Book that return trip for two on Skyline, then **Claim** one of the caps → Booking page link | One check of the booking claims both flights (payout × 2 travellers each); the opted-in Drop Guarantees are added with the same booking. |
| Web: **Check a flight** → "Any flight on this route and day" | The quote shows the cheapest verified fare among the tracked flights; claim with whichever flight on that route and day you booked. |
| Web: **Policies** → "Get alerts" | Turn on push for this browser, or add an email (demo: the confirmation and alerts appear in the demo outbox). "Needs your attention" lists what to do now. |
| `cd web && pnpm e2e` (stack running) | Playwright: quote → buy → claim → payout; UI premium = contract `preview_premium`; passenger binding; live check; return trip for two with the Drop option; route cover; email alerts with double opt-in. Start the stack with `RELAYER_ACCOUNTS_PER_IP_DAY=50` (each test signs up an account). |

## 5. Payout and premium formulas in plain language

* **Price Cap payout** = the lower of the airline's price when you booked and what you paid,
  minus your cap, minus the deductible — never below zero, never above the maximum payout.
  Only bookings made after the activation delay and before expiry count.
* **Route cover (option)** — the "airline's price" is the cheapest available fare among the
  non-stop flights CapFare tracks on that route and day, in the covered fare class. You can book
  any of them; the payout still uses min(that index, what you paid).
* **Travellers** — cap, deductible and maximum payout are per traveller; premium, locked
  coverage and payout are multiplied by the travellers covered (the lower of the policy's and
  the booking's number). **Return trips** are two policies bought in one go; one booking claims
  both, each flight once.
* **Drop Guarantee after a claim (option)** — chosen when buying a cap; at claim time the same
  verified booking buys a Drop Guarantee (public formula, at most the premium you agreed to).
* **Drop Guarantee payout** = what you paid minus the lowest airline price seen during the
  7-day window, minus the deductible — never below zero, never above the maximum payout.
* **Timing** — non-refundable tickets are paid when the claim is verified; refundable or
  unknown tickets after a **live** check of the booking one day before departure (cancelled ⇒
  no payout). The email alone is not enough for refundable tickets. If nobody submits that
  check by departure + grace, anyone can close the claim without payout, so the coverage goes
  back to the vault.
* **How bookings are checked** — the original confirmation email (DKIM-signed) or a live
  check: the user's own manage-booking link, which the checker loads straight from the
  booking site. Either way the booking must belong to the lead passenger named when buying.
* **Premium** = base price (table by ticket price and days to departure) × price-momentum
  multiplier × seat-availability multiplier × season multiplier × vault-utilisation multiplier
  × cap-distance adjustment, rounded up and kept within a min/max. Computed on-chain at
  purchase from the latest signed price snapshot. Parameters change only after a timelock.

## 6. Backtest summary

[docs/PRICING.md](docs/PRICING.md): synthetic fare paths (fare-bucket closures, volatility
bursts, promotions, sell-outs, seasonality) and four buyer models (uninformed, informed,
breakage, refundable cancellers). The exported parameters keep both vaults profitable in the
simulation with median premiums of a few euros on tickets up to €300. Limitations: **all
synthetic**; buyer behaviour is assumed; utilisation surcharge not exercised; must be re-fitted
on real fares.

## 7. Threat model summary

[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Main trust assumptions: enclave keys are
registered only after the owner verifies the TDX quote off-chain (contract does not), with a
public timelock; TEE hardware side channels are a residual risk; demo deployments use
development keys and accept demo prices only because they were initialised that way. Covered
threats include oracle manipulation, stale data, forged/forwarded mail, replays, double claims,
cancel-after-claim, adverse selection, concentration, LP runs, relayer abuse, PII leakage,
admin misuse and async callback failures.

## 8. Legal

Testnet prototype; no real money. A commercial launch would require partnering with a
licensed insurer or other appropriately licensed financial partner, and a licensed payment
provider. See [docs/LEGAL.md](docs/LEGAL.md).

## 9. Third-party code

* Libraries: near-sdk, near-contract-standards, near-sandbox, near-api (Rust); near-api-js,
  near-sandbox (JS); @noble/curves and @noble/hashes; mailauth (DKIM/ARC); postal-mime;
  @phala/dstack-sdk; borsh; Next.js, React; Fontsource (Atkinson Hyperlegible Next, Outfit);
  Playwright, Vitest, linkedom, esbuild; numpy, matplotlib, pytest; proptest, ed25519-dalek.
* Plane glyph in the logo adapted from Material Icons ("flight", Apache-2.0). Logo artwork
  supplied by the project owner and redrawn as SVG.
* No pre-existing project code; everything was written during the hackathon window.

## Hosting (Railway)

`railway.json` + `deploy/Dockerfile` run the whole demo in one container: a local NEAR
sandbox, the contracts, the price oracle and booking checker (demo mode), the relayer and the
web app. No secrets are required for it to start. Recommended variables:

| Variable | Why |
|---|---|
| `SITE_URL` | Your public address (e.g. `https://capfare.up.railway.app`). Used in page metadata, in booking links inside Skyline's emails, and so the booking checker accepts live checks of those links. |
| `ORACLE_DEV_SEED`, `VERIFIER_DEV_SEED` (secrets) | 32-byte hex each (`openssl rand -hex 32`). Without them the demo enclave keys are derived from a public string in the source, so anyone could sign fake prices or bookings for your demo chain. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret), `VAPID_SUBJECT` | Web-push keys for alerts (`npx web-push generate-vapid-keys`). Without them a new pair is generated on every redeploy and existing push subscriptions stop working. |
| `EXTENSION_URL`, `X_URL`, `GITHUB_URL` | Optional links on the landing page. |
| `ONECLICK_API_KEY` (secret) | Optional; NEAR Intents dry quotes work without it. |

`SMTP_URL`/`MAIL_FROM` are not needed: demo deployments keep alert emails in the demo outbox.
State (sandbox chain, accounts, bookings) resets on every redeploy or restart.

## 10. Decisions and deviations

[docs/DECISIONS.md](docs/DECISIONS.md) lists every deviation from the brief and later decisions (D1–D34).
Landing design plan, review and revisions with screenshots: [docs/LANDING_DESIGN.md](docs/LANDING_DESIGN.md).
Hosting: `deploy/Dockerfile` + `railway.json` run the whole demo stack in one container.

## License

MIT — see [LICENSE](LICENSE).
