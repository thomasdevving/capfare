# Architecture

CapFare sells two flight-price protections — **Price Cap** (before booking) and **Drop
Guarantee** (after booking) — for one exact flight, date, fare class and airport pair. Payouts
come from two independent, fully collateralised vaults on NEAR. Prices and bookings are
checked by services designed to run in TEEs. Users get gasless named accounts.

```
 Browser / Chrome extension                   Services (TEE-designed)            NEAR (testnet / sandbox)
 ─────────────────────────                    ───────────────────────            ────────────────────────
 web app (Next.js)  ── quote ──────────────►  price_oracle  ──signed snapshots─┐
   │  seal(.eml | ref+name) to enclave key                                     │  relayer (NEP-366)
   ├──────────────────────────────────────►  booking_verifier                  ├──► attestation_registry
   │                       signed attestation ◄─┘                              │     keys · snapshots · nullifiers
   │  sign delegate action (user key) ──────────────────────────────────────── ┘──► policy_registry
   │                                                                                 premium engine · policies ·
   │                                                                                 claims · credit
   └─ reads (cached API routes) ◄──────────────────────────────────────────────── cap_vault / drop_vault
                                                                                     shares · epochs · locked coverage
                                                                               tUSDC (NEP-141, mock on demo)
```

## Contracts (`/contracts`, Rust, near-sdk 5.30)

| Crate | Role |
|---|---|
| `core` (`capfare-core`) | Pure types and formulas: flight-key hashing, signing payloads, premium formula, payout rules, parameters. Shared by every contract and mirrored bit-for-bit in TS (`/shared`) and Python (`/backtest`) via conformance vectors. |
| `vault` | LP vault, deployed twice (`cap_vault`, `drop_vault`). Weekly epochs for deposits and withdrawals, full collateralisation, unearned premiums kept outside LP assets until a policy resolves, rollback on every failed transfer. |
| `attestation_registry` | Enclave keys/measurements (timelocked add, immediate revoke), signed oracle snapshots with history, booking-attestation verification, per-product nullifiers. |
| `policy_registry` | Premium engine (on-chain formula + timelocked params), policy lifecycle, claims and settlement, payout timing (24-hour free-cancellation window, refundable fares), buyer options (deductible, duration, flexible route cover), renewals, exposure caps, per-user limits, prepaid credit. |
| `mock_ft` | "Test USDC" for demos and tests, with failure injection. |
| `tests` | Sandbox integration tests (near-sandbox + near-api). |

### Purchase (both products)

`buy_caps` takes one or two legs (outbound + return), 1–9 travellers, and per leg either an
exact flight or a route (`Coverage::Flight | Coverage::Route`); `buy_cap` is the one-leg,
one-traveller shorthand. All legs are priced and checked before any is recorded.

```
buy_caps / buy_drop
  ├─ attestation.get_latest_snapshot | consume_booking(drop)   ┐ joint promise
  └─ vault.get_state                                           ┘
on_*_inputs: price with the public formula, check snapshot age, exposure caps,
             per-user limits, liquidity; debit credit; policy = Funding
  └─ token.ft_transfer_call(premium → vault, msg {policy, lock})
        vault.ft_on_transfer: lock max payout if free liquidity ≥ lock, else refuse
on_policy_funded: Active — or roll back credit, exposure, counters, nullifier
```

### Claim / settlement / payout

```
claim_cap(attestation, booked_flight?)   settle_drop(status attestation at window end)
  └─ attestation.consume_booking            └─ attestation.check_status (+ lowest price in window)
     (nullifier per flight; route caps: index = route snapshot, booked flight must match)
     payout = per-traveller payout × min(policy travellers, booking travellers)
on_cap_claim / on_drop_settled: compute payout with capfare-core
  live check ≥ booked_at + 24 h (non-refundable)  → vault.payout now
  otherwise                                       → hold; finalize_claim(live check ≥ booked_at + 24 h,
                                                    and ≥ departure − lead for refundable/unknown fares)
                               active → pay, cancelled → void (coverage released)
vault.payout: paid part leaves locked coverage; transfer; callback confirms or rolls back
on_vault_resolved: PaidOut / Expired / Voided — or Claimed + retry_payout
void_unconfirmed_claim: held claim without final check after departure + grace → Voided
buy_drop(attestation, from_cap): Drop Guarantee with the booking a cap was claimed with (linked)
```

### Invariants

* Vault, after every state change: `total_assets ≥ locked_coverage + pending_withdrawals`.
* Vault token balance = `total_assets + unearned + fees + pending_deposits + claimable + in_flight`.
* Registry token balance = `credit_total + in_flight`.

Checked by property tests (random action sequences incl. failed transfers) and after every
step of the sandbox lifecycle test.

## Services

| Path | Role |
|---|---|
| `tee/common` | Key providers (dstack/TDX in production, dev seed for demos), report binding `sha256(signing_pk ‖ box_pk)`, HTTP helper, rate limiting, PII-redacting logger. |
| `tee/price_oracle` | Price adapters (scripted demo adapter; airline-site adapters exist but are disabled where terms forbid automation), signal computation, signing, route index (cheapest available fare over the tracked flights on a route and day, keyed by the route key hash), scheduler for flights and routes with active policies, submission via the relayer. |
| `tee/booking_verifier` | Opens client-sealed inputs; DKIM/ARC checks on original `.eml`; airline/OTA template parsers; **live checks**: fetches the user's own manage-booking page from an allowlisted booking site and reads it (`tls_page`); manage-booking logins (demo airline); nullifier `H(salt ‖ airline ‖ ref)`; passenger commitment from the lead passenger and the user's salt; emits signed, PII-free attestations. |
| `web/app/booker` | Skyline Travel (demo): mock booking site used by the demo, the extension and the tests. |
| `notifier` | Alerts: computes them with the shared alert engine (`shared/src/alerts.ts`) from public chain state and, for watched prices, oracle prices (D36), and delivers new ones by web push (VAPID) and email (SMTP, double opt-in; demo outbox). Settings are signed with the account's own key, checked on-chain. |
| `relayer` | Wraps users' NEP-366 delegate actions (allowlisted contracts/methods, bounded deposits/gas, per-account and per-IP limits), creates named accounts, submits pre-verified snapshots. |
| `web` | Next.js app: landing, quote/buy, policies, claim, credit (mock ramp, Intents dry quotes), LP dashboard, transparency, legal/FAQ. Cached read-only API routes. |
| `extension` | Chrome MV3: a generic reader (any booking site) and site adapters extract flight + price hints and show an overlay; purchases hand off to the web app. |
| `backtest` | Synthetic/real fare paths, buyer models, calibration and parameter search, `premium_params.json`, `docs/PRICING.md`. |
| `scripts` | Sandbox, deploy (sandbox/testnet), enclave-key registration, scripted demo, full local stack. |

## NEAR technologies used, and why

* **Smart contracts (Rust, near-sdk)** — vault accounting, public premium formula and payouts
  must be verifiable by anyone.
* **Asynchronous cross-contract calls with callbacks** — every value transfer has an explicit
  rollback path (tested by forcing failures).
* **NEP-141** — settlement token; `ft_transfer_call` for deposits, premiums and credit top-ups.
* **NEP-366 meta-transactions + relayer** — users never hold NEAR or see gas.
* **Named accounts** — `alice.<relayer>.testnet` instead of hex addresses.
* **`env::ed25519_verify`** — on-chain verification of enclave signatures.
* **NEAR Intents (1Click API)** — quotes for paying out or topping up in other assets
  (dry quotes only; Intents has no testnet).
* **TEEs** — enclave key registration follows the Shade-Agent pattern (approved measurement +
  attested key), with off-chain quote verification and a timelock (see THREAT_MODEL.md).
