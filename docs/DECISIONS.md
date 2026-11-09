# Decisions and deviations from the brief

Each entry: what we did, why, and what it would take to change it.

**D1. Premium engine and credit are modules, the formula lives in `capfare-core`.**
The brief allows both as registry modules. The pure formula is in `contracts/core` so the
contracts, the TS port (`/shared`) and the Python backtest share one definition, checked by
`shared/test-vectors/vectors.json` (generated from Rust).

**D2. Sandbox tests use `near-sandbox` + `near-api` instead of `near-workspaces`.**
The current NEAR docs (smart-contracts/testing/integration-test) recommend this pair. In
containers that cannot raise `RLIMIT_NOFILE`, `scripts/dev/rlimit_shim.c` (LD_PRELOAD) clamps
the request; CI does not need it.

**D3. Extra fields in signed payloads.** `PriceSnapshot.departure_ts` (the chain needs an
absolute departure time for days-to-departure and the final status check);
`BookingAttestation.booked_at` (needed for the cap window `[active_from, expires_at]`) and
`currency`. `refundable` is tri-state (`non_refundable | refundable | unknown`) because 5.3
treats "unknown" separately.

**D4. EUR policies, USDC settlement with a locked FX rate.** Prices, premiums and payouts are
EUR cents; the vault holds USDC. `usdc_micro_per_cent` is a timelocked parameter and is
copied into each policy at purchase, so the locked coverage exactly covers the max payout
whatever happens to the rate later. Premiums and locks round up, payouts round down. A
signed FX feed would replace the parameter in a production version.

**D5. Unearned premiums stay outside LP assets until the policy resolves.** This prevents LPs
from depositing just before a premium is booked as income, makes sold-out refunds exact, and
keeps the invariant trivial. The protocol fee is taken at resolution.

**D6. `pending_withdrawals` is a reservation made at request time.** Requesting a withdrawal
reserves the shares' current value (rounded up) from free liquidity; at the epoch the LP gets
the epoch value, never more than free liquidity allows. Deposits are minted after
withdrawals at the post-withdrawal share price, rounded against the depositor. Virtual
shares/assets (1e6 each) prevent first-depositor inflation. Queues are processed in one call
and bounded at 200 entries per epoch.

**D7. Extra policy state `Funding`.** The policy exists while the premium is in flight to the
vault; it becomes `Active` or `Voided` in the callback.

**D8. Drop Guarantee purchase is refused if the oracle price is already below the paid
price.** Otherwise a buyer could insure a drop that has already happened.

**D9. A cap claim needs a valid oracle index at booking time.** If no available-fare snapshot
exists within `max_index_snapshot_age_secs` before `booked_at`, `consume_booking` fails and
nothing is consumed; the claim can be retried (e.g. after the oracle backfills nothing — so
in practice the oracle must snapshot flights with active policies at least every few hours,
which the scheduler does).

**D10. Test USDC token on demo deployments.** Circle's testnet USDC
(`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`) cannot be minted by a
script, so demos deploy `mock_ft` ("tUSDC", 6 decimals, faucet). `deploy.ts` accepts
`TOKEN_ID` to use the real testnet USDC instead.

**D11. TEE trust: dstack/TDX keys, off-chain quote verification, timelocked registration.**
Full TDX quote verification on NEAR is not practical for us here. Following the Shade-Agent
pattern (approved measurement + attested key): the enclave derives its keys from the dstack
KMS and binds `sha256(signing_pk ‖ box_pk)` into the quote's REPORTDATA;
`scripts/src/verify-report.ts` checks that binding and the quote (via `dcap-qvl` when
installed); the owner publishes the key with `propose_key` (report hash on-chain) and anyone
applies it after the timelock. Revocation is immediate. Demo deployments use development keys
that are labelled as such and only accepted where `allow_demo_sources = true`.

**D12. No live airline price adapter.** KLM and Transavia website terms do not permit
automated access to their booking flows, and we have no data agreement. Their adapters are
marked demo-only and refuse to run outside demo deployments. The scripted adapter replays
JSON paths and tags snapshots `source_id = "demo"`; the attestation registry rejects those
unless the deployment was initialised with `allow_demo_sources = true` (immutable).

**D13. Email template parser written against synthetic fixtures.** We could not inspect real
KLM confirmation emails at scale. The DKIM/ARC checks are what protect the system; the parser
must be validated with real mails before use. Fixture emails are generated at runtime,
signed with an ephemeral key under the selector `capfare-fixture`, visibly marked as
synthetic, and only demo deployments resolve that selector.

**D14. Manage-booking status checks: demo airline only.** Same terms-of-service reason as
D12. The status-check path is fully implemented against a mocked manage-booking page.
Final checks and drop settlements need the user (or their app) to submit a fresh status check;
we do not keep booking references in sealed storage in v1.

**D15. Accounts: relayer-created named accounts with browser-held keys.** NEAR Auth
(FastAuth) needs approved Auth0 credentials and documents mainnet setup; Privy needs an app
id. For the testnet prototype the web app creates a key in the browser (protected by a
passkey via the WebAuthn PRF extension where available, otherwise a device key in local
storage, clearly labelled testnet-only) and the relayer creates `name.<relayer>` with that
key. A production version would plug NEAR Auth into the same `KeyStore` interface.

**D16. The extension hands purchases to the web app.** The extension never holds keys. Its
overlay quotes via the web API and opens the web app (same session) to confirm, sign and
relay. This keeps one signing surface.

**D17. Snapshots are submitted by the relayer account** after it checks each signature and
that the signer is a registered oracle key, so gas is never spent on junk.

**D18. NEAR Intents: dry quotes only.** Intents has no testnet. The app requests 1Click
quotes with `dry: true` to show what a payout or top-up in another asset would return, and
never moves funds.

**D19. Hosted demo on a sandbox chain if testnet accounts are unavailable.** From the build
environment we could not reach the testnet faucet, so the container image can run a local
NEAR sandbox with the whole stack (`deploy/Dockerfile`). Every page then shows
"Network: local sandbox". `scripts/src/deploy.ts NETWORK=testnet` deploys the same code to
testnet with your funded account.

**D20. Optional lending-market yield not implemented.** The brief marks it optional; vault
assets are idle. Adding it means a separate adapter that only moves a capped share of free
liquidity and is removed from `total_assets` accounting until withdrawn.

**D21. Payout destination.** Payouts go to the owner's NEAR account (USDC). Sold-out premium
refunds go back to credit. IBAN off-ramp and Intents payouts start from the user's balance
(mock ramp / dry quotes on testnet).

**D22. Visual direction changed by the project owner.** The original plan (white surfaces,
graphite text, yellow accent, no gradients) was replaced on the owner's instruction by a
dusk-sky background with translucent glass panels on every page and in the extension, plus
the owner's logo. Outfit is used for headings and the wordmark. See LANDING_DESIGN.md,
revisions 2–4, for what was taken from the reference and what was left out.

**D23. Demo booking site.** `/demo-airline` on the web app is a clearly labelled stand-in
booking site ("Skyline Travel (demo)"). It is the only site the extension has a working,
fixture-tested adapter for, so it is the only one named on the landing page.

**D24. Extension permissions.** The manifest requests no API permissions and a single host
permission: the CapFare app origin (API and demo site). Content scripts run only on
`/demo-airline*` there. Adding a real site means adding its origin, an adapter and fixtures.
