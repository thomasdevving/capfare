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

**D14. Server-side manage-booking logins: demo airline only.** Same terms-of-service reason
as D12: the enclave logging into an airline with booking code + last name is only implemented
against a mocked airline page. The user-initiated live check (D26) replaces it in practice.
We do not keep booking references in sealed storage.

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

**D23. Demo booking site: Skyline Travel (demo).** `/booker` on the web app is a full mock
booking site, inspired by large OTAs: search with any of 12 airports and dates, results with
airline/time/price filters and Best/Cheapest/Fastest sorting, three fares per flight
(Light/Standard/Flex, Flex refundable), passenger details for 1–4 travellers, a test-card
payment step, confirmation page, "My trips" lookup by booking code + last name, a manage page
with cancellation, and a demo inbox with real DKIM-signed `.eml` confirmations
(`skyline-travel.example`). Schedules and prices come from a deterministic demo fare model
(`shared/src/demo-fares.ts`) that the oracle's demo price source uses too, so both always
agree; where CapFare already has an on-chain price for a flight, the site shows that price.
Every page carries a "demo booking site" banner. It is the only site with a working extension
adapter, so it is the only one named on the landing page.

**D24. Extension permissions.** The only required host permission is the CapFare app origin
(API and demo site), where a static content script runs on `/booker*`. Other sites are read in
two ways, both chosen by the user (superseded in part by D35): `activeTab` + `scripting` for
"Check this page" in the popup, and the optional host permission `https://*/*`, asked for only
when the user turns on automatic checks. None of the required permissions shows an install
warning. `storage` keeps per-tab state for the popup in session storage.

**D25. Passenger binding.** A Price Cap stores a commitment
`sha256("capfare/passenger/v1" ‖ borsh(normalised last name) ‖ salt)`; the salt is
`sha256(ed25519 signature of a fixed message)` made with the user's own key, so it is
deterministic and never stored. The enclave recomputes the commitment from the booking's lead
passenger, using the salt the user seals to it, and signs it into the attestation; the
contract requires equality for claims, settlements and final checks (a Drop Guarantee takes
its commitment from the booking it was bought on). This stops someone using another
traveller's confirmation. The name never reaches CapFare's servers or the chain.

**D26. Live booking check ("Verify with CapFare") instead of a zkTLS integration.** The user
hands CapFare the link to their own manage-booking page (the extension does it with one button
on supported sites; on mobile they paste it). The booking checker, inside the enclave, loads
that page directly from the booking site (allowlisted origins only, HTTPS required outside demo
deployments) and attests the booking as it is now: method `tls_page`. This gives the same
property we wanted from zkTLS — data that comes from the booking site's server, not from the
user's browser — under the TEE trust assumption we already make, with no extra notary service.
A real zkTLS provider (Reclaim, TLSNotary, Opacity) can replace it behind the same endpoint;
the attestation format already has the method field. Reading the page inside the extension was
rejected: the user controls that page, so on its own it proves nothing.

**D27. Refundable tickets need a live check.** An email shows that a booking existed, not
that it wasn't cancelled. For refundable or unknown fares, `finalize_claim` and
`settle_drop` only accept live attestations (`status_check` or `tls_page`); the attestation
registry enforces this (`require_live`). Non-refundable tickets can be settled with the email
alone, because cancelling one returns nothing.

**D28. Travellers per policy.** One policy covers 1–9 travellers on one booking
(`Policy.seats`, `MAX_SEATS = 9`). Cap, deductible and maximum payout stay per traveller, so the
public formula and the backtest parameters are unchanged; the premium is the per-traveller
premium × seats, priced with the whole policy's lock in the utilisation term and the other seats
counted as flight exposure. Locked coverage, exposure caps and payouts scale with seats. The
booking checker attests the number of travellers (`BookingAttestation.seats`, `paid_price_minor`
per traveller) and a claim pays min(policy seats, booking seats). Group pricing (a discount for
more travellers) is not offered: we have no data that seats on one booking are less risky.

**D29. Return trips: two legs bought together, nullifiers per flight.** `buy_caps` takes one or
two legs; both are priced and checked first (credit, per-day limit, combined route-week exposure)
and only then recorded, so a failing leg leaves nothing behind. Each leg is funded separately;
legs share `trip_id`. One booking holds both flights, so nullifiers are now spent per flight:
`leg_nullifier = H(booking nullifier ‖ flight key hash)`. A leg can still be claimed only once per
product. Claims stay one transaction per leg (each has its own index and payout, and a two-claim
delegate would exceed the gas limit). The checker refuses to attest a flight when the booking only
shows a total for several flights — it previously used the trip total as the price of one flight,
which would have overpaid a Drop Guarantee.

**D30. Route cover (option).** `Coverage::Route` covers every non-stop flight the oracle tracks on
a route and day in one fare class. The oracle publishes a route snapshot keyed by the route key
hash: the cheapest available fare, the earliest departure (so expiry and the final check are
never later than any covered flight) and the least constrained availability bucket, plus one
snapshot per flight. The cap index at booking is the route snapshot; the claim names the booked
flight, which must match route, day and fare class. Route caps use the cap parameters unchanged:
the index is a minimum over flights, so it rises no faster than any single flight, and payout
still uses min(index, paid). We have not backtested route cover separately (PRICING.md
limitations). Drop Guarantees always cover the booked flight.

**D31. Drop Guarantee after a claim (option).** Chosen when buying a cap
(`auto_drop_max_premium_minor`). After the claim the app buys a Drop Guarantee with the same
verified booking (`buy_drop(…, from_cap)`); the contract checks that the booking is the one the
cap was claimed with and links both policies. It is a separate purchase at the public formula, not
a discount (no data supports one), and it is still subject to the 24-hour purchase window and to
"price already below what you paid". Users who did not opt in get a one-tap offer instead.

**D32. Held claims time out.** A refundable/unknown-fare claim waits for a live final check. If
none is submitted by departure + `claim_grace_secs`, anyone may call `void_unconfirmed_claim`:
the claim closes without payout and the coverage returns to the vault. Before this, the locked
coverage stayed out of LPs' reach indefinitely. Alerts remind the traveller first (D33).

**D33. Alerts and the notifier service.** One pure alert engine (`shared/src/alerts.ts`) derives
what a policy holder should know or do from public chain state; the web app shows it in-app and
`notifier/` delivers new alerts by web push (VAPID) and email. Settings changes are signed with
the account's own ed25519 access key and the key is checked on-chain (`view_access_key`), so only
the account holder can add channels. Email needs double opt-in. The notifier is the only CapFare
component that stores personal data (an email address, if given); it is kept in one file, masked
in responses, never logged, and deleted on request. It is a normal service, not an enclave:
alerts are built from public data, and the email address is not needed by any enclave. Demo
deployments keep mail in an outbox. Housekeeping calls (expire, sold-out refund, closing
unconfirmed claims) are not automated by the notifier yet.

**D34. Account-creation quota is configurable.** The relayer's new-accounts-per-IP-per-day limit
(default 5) is read from `RELAYER_ACCOUNTS_PER_IP_DAY`, so the e2e suite (one account per test)
can run on one IP; production keeps the default.

**D35. The extension works on any booking site.** Site-specific adapters cannot keep up with
hundreds of airline and travel sites whose markup changes weekly, so a generic reader
(`extension/src/adapters/generic.ts`) handles every site without an adapter. In order of trust
it uses schema.org `FlightReservation`/`Flight` structured data (JSON-LD or microdata, which
airlines publish for confirmations), the page address (origin, destination, date, travellers in
the query, hash or path), and the visible text: flight numbers of known airlines and known
airport codes only (`iata.ts`; codes that are everyday words are left out), dates in seven
languages, and prices grouped per result card by walking up from each flight number to its
price. Itinerary prices (connections) and add-ons are not read as a flight's price. Comparison
sites that show no flight numbers fall back to route cover (D30) on the route and day; a route
from the address alone also needs the page to mention the route or flights. The page price stays
a hint (premiums use oracle snapshots) and only the flight key goes to CapFare, never the page
address. On sites without a live-check origin (D26), the manage-page overlay points to the
email upload instead of "Verify with CapFare". Coverage is still limited by the price oracle:
on testnet only demo routes have prices, so elsewhere the extension stays quiet unless the user
asked ("Check this page"), in which case it says what it found.

**D36. Free price watches.** Most visitors are not ready to buy cover the first time they see a
flight. "Watch the price" (Check a flight, the extension's "Watch the price for free" link) keeps a
watch with the notifier: coverage (flight, or route and day), travellers, the verified price when
it started and an optional target. Nothing goes on-chain and nothing is paid. The notifier asks
the oracle for a fresh signed price without submitting it (`submit: false`; hourly, every tick on
demo deployments), falling back to the latest on-chain snapshot. The shared alert engine
(`watchAlerts`) alerts once per 10% band (at least €10) up or down, once when the target is met,
and when the fare sells out; each alert links back to a quote. Watches are removed after the
departure day and capped at 20 per account. Which flights someone watches is personal: it is
kept only in the notifier's file, read and changed only with requests signed by the account key
(D33), and deleted with the watch. Watches also show which routes people want, so they say
which prices to source first once real price sources exist.

**D37. Paste a link, or share one.** The address reader of the extension's generic adapter
(D35) lives in `shared/src/booking-link.ts`, so "Paste a link from any booking site" on Check a
flight reads the same things: origin, destination, dates, return date, travellers and flight
number from query, hash and path, and Google Flights' `tfs` search token (a base64 protobuf in
which dates and airport codes are plain strings). A link without a flight number selects route
cover. The web app manifest declares a Web Share Target, so on phones that support it "Share"
in any booking app or browser offers CapFare and opens Check a flight with the link already
read: the extension's main benefit, without an extension.

**D38. One-tap lock from price alerts (option, off by default).** A watch alert (D36) about a
rise or a met target can carry a second action, "Lock at €…", next to its normal link. It opens
Check a flight with `quick=1&cap=…`: the quote loads by itself, the maximum price is the one in
the alert (6% above the price when the alert was made, rounded up to €5; today's default if the
price has passed it since), and a summary sits next to the Lock button. Nothing is bought
without the user pressing Lock and signing; credit, the waiting time and the premium formula
apply as always. The option is a per-account notifier setting (`set_quick_lock`, signed like the
other settings). With it off, alerts, emails and push notifications are exactly as before, and
the normal link and full form always work. Push notifications show the two actions as buttons
where the browser supports them; tapping the notification itself opens the normal link.
