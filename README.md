# CapFare

CapFare sells flight-price protection for **one exact flight, date, fare class and airport
pair**, wherever the traveller books. A **Price Cap** (bought before booking) pays the
difference if the airline's price for that flight rises above your cap before you book. A
**Drop Guarantee** (bought right after booking) pays the difference if the price of the same
flight drops within 7 days. Payouts come from two independent, fully collateralised vaults on
NEAR funded by liquidity providers. Prices and bookings are checked by services built to run
in TEEs, so no personal data reaches CapFare's servers or the chain. Users get gasless named
accounts with a passkey and prepaid credit.

> **Testnet prototype.** No real money. CapFare is price protection, not insurance; a
> commercial launch would require a licensed insurer or other licensed partner (docs/LEGAL.md).

## 1. What is real, what is simulated, what does not exist yet

| Real (runs, tested) | Simulated / demo | Not built yet |
|---|---|---|
| Rust contracts: vault ×2, policy registry (premium engine, claims, credit), attestation registry; full collateralisation; epochs; nullifiers; timelocked params and keys; rollback of every failed transfer | Prices in demos come from a **scripted demo price source** (`source_id = "demo"`) | A live airline price adapter: airline terms forbid automated access (D12) |
| Sandbox integration tests incl. forced failures; property tests on payouts, premiums and vault invariants | Booking confirmations in demos are **synthetic DKIM-signed emails** (selector `capfare-fixture`) | Live manage-booking status checks for real airlines (D14) |
| Public premium formula identical in Rust, TS and Python (conformance vectors) | Services run with **development keys**, not inside a TDX enclave (dstack key provider is implemented, untested on hardware) | On-chain TDX quote verification (D11) |
| Booking verifier: DKIM/ARC checks, forwarded/modified mail rejection, template parsing, nullifiers, PII-free signed attestations | Fiat top-ups and IBAN payouts: `MockRampProvider` (no money moves) | Licensed ramp provider integration (skeleton only) |
| NEP-366 relayer (gasless), named accounts, passkey (WebAuthn PRF) or device keys | Test USDC (mock NEP-141 token) on demo deployments | Optional lending-market yield on idle vault funds (D20) |
| Web app (landing, quote, policies, claim, credit, LP dashboard, transparency), Chrome extension with a fixture-tested adapter | NEAR Intents: **dry-run quotes only** (Intents has no testnet) | Chrome Web Store listing |
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
| `pnpm --filter @capfare/scripts stack -- --web` | Full stack: sandbox, contracts, oracle :8081, verifier :8082, relayer :8083, web on http://localhost:3000. |
| `CAPFARE_APP_URL=http://localhost:3000 pnpm --filter @capfare/extension build`, then Chrome → Extensions → Developer mode → Load unpacked → `extension/build` | Open http://localhost:3000/demo-airline: the CapFare overlay offers a cap; the confirmation page offers a Drop Guarantee. |
| Web: **Account** → create with passkey (or device key) | A named account `name.sandbox` is created by the relayer; no gas needed. |
| Web: **Credit** → "Top up €20 (simulated iDEAL)" | 21.60 tUSDC credit (rate 1.08 USDC/EUR). |
| Web: **Check a flight** → KL1695, 2027-06-14, AMS→BCN, Economy Light → Get a quote → Lock | Premium from the public formula; policy active; max payout locked in cap_vault. |
| Web: **Policies** → wait for activation → "Demo: next scripted price" ×3 | Airline price €260 (scripted). |
| Web: **Claim** → Demo confirmation → paid €255 → Check my booking | Payout €70 = min(260, 255) − 180 − 5, paid to your wallet. |
| Web: **Transparency** | Parameters, pending changes, enclave keys, oracle freshness, collateral check. |
| Web: **LP** | Vault state, share price per epoch, exposure by flight and route-week, deposit/withdraw. |
| `cd web && pnpm e2e` (stack running) | Playwright: quote → buy → claim → payout; UI premium = contract `preview_premium`. |

## 5. Payout and premium formulas in plain language

* **Price Cap payout** = the lower of the airline's price when you booked and what you paid,
  minus your cap, minus the deductible — never below zero, never above the maximum payout.
  Only bookings made after the activation delay and before expiry count.
* **Drop Guarantee payout** = what you paid minus the lowest airline price seen during the
  7-day window, minus the deductible — never below zero, never above the maximum payout.
* **Timing** — non-refundable tickets are paid when the claim is verified; refundable or
  unknown tickets after a status check one day before departure (cancelled ⇒ no payout).
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

## 9. Third-party code and AI disclosure

* Libraries: near-sdk, near-contract-standards, near-sandbox, near-api (Rust); near-api-js,
  near-sandbox (JS); @noble/curves and @noble/hashes; mailauth (DKIM/ARC); postal-mime;
  @phala/dstack-sdk; borsh; Next.js, React; Fontsource (Atkinson Hyperlegible Next, Outfit);
  Playwright, Vitest, linkedom, esbuild; numpy, matplotlib, pytest; proptest, ed25519-dalek.
* Plane glyph in the logo adapted from Material Icons ("flight", Apache-2.0). Logo artwork
  supplied by the project owner and redrawn as SVG.
* No pre-existing project code; everything was written during the hackathon window.
* **AI-assisted:** the code, tests and documentation in this repository were written with
  Claude Code (Anthropic) under the direction of the project owner.

## 10. Decisions and deviations

[docs/DECISIONS.md](docs/DECISIONS.md) lists every deviation from the brief (D1–D24).
Landing design plan, review and revisions with screenshots: [docs/LANDING_DESIGN.md](docs/LANDING_DESIGN.md).
Hosting: `deploy/Dockerfile` + `railway.json` run the whole demo stack in one container.

## License

MIT — see [LICENSE](LICENSE).
