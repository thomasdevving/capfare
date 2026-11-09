# Threat model

Scope: the testnet prototype in this repository. "Owner" is the admin account of the
contracts; "enclave" means a booking_verifier or price_oracle instance whose key is
registered on-chain.

## Trust assumptions (what you have to believe)

1. **Enclave keys belong to measured code.** A key is registered only after the owner has
   checked that the TDX quote's REPORTDATA commits to `sha256(signing_pk ‖ box_pk)` and that the
   quote verifies (`scripts/src/verify-report.ts`, using `dcap-qvl` when installed), and after a
   public timelock during which anyone can inspect the published report hash. The contract does
   **not** verify the quote itself. If the owner registers a key without that check, the
   enclave guarantees do not hold.
2. **TEE hardware is sound.** Side channels and microcode bugs in Intel TDX are a residual
   risk. Mitigations: short attestation lifetimes, immediate key revocation, nullifier salts
   derived inside the enclave, no long-term storage of booking data.
3. **Demo deployments use development keys.** Every demo key is labelled `dev` in its report;
   demo price sources are accepted only where `allow_demo_sources` was set at initialisation
   (it cannot be changed later). Testnet demos make no privacy promise beyond "test data".
4. **Airline emails are DKIM-signed by the airline.** If an airline does not sign, or signs with
   `l=` (partial body), we reject the mail.

## Threats

| Threat | Mitigation | Residual risk |
|---|---|---|
| **Oracle manipulation** (fake prices to trigger payouts) | Snapshots need a registered `price_oracle` key and matching measurement; signatures verified on-chain (`ed25519_verify`); the payout index is the airline price at booking time, capped by what the user actually paid (`min(index, paid)`); per-flight and per-route-week exposure caps limit damage per flight. | A compromised oracle key can still push false prices until revoked. |
| **Stale snapshots** | Quotes need a snapshot ≤ `max_quote_snapshot_age_secs` old; submissions older than `max_snapshot_submit_age_secs` or from the future are rejected; per flight, snapshots must be strictly newer; the cap index must be within `max_index_snapshot_age_secs` before booking. | Gaps in oracle coverage can make a cap unclaimable (D9); the scheduler snapshots flights with active policies hourly (15 min near departure). |
| **Compromised enclave key** | `revoke_key` takes effect immediately; new keys need a timelock; keys are bound to a measurement. | Payouts already made with forged attestations are not reversible. |
| **Forged or modified emails** | DKIM must pass for an allowlisted airline domain aligned with From; From and Date must be signed; body hash must match (no `l=`). Tests: valid, modified, forwarded, Gmail re-signed, wrong domain, unsigned. | Template parsers were built on synthetic fixtures (D13). |
| **Forwarded emails** | Rejected: forward subject prefixes, `Resent-*`/`X-Forwarded-*` headers, or a provider re-signature (non-airline DKIM domain). ARC is accepted only if the first hop saw `dkim=pass` for the airline. | A user could hand-craft headers, but cannot forge the airline's DKIM signature. |
| **Replayed attestations** | `verified_at` must be within `max_attestation_age_secs`; status checks must be verified after the relevant moment (window end, final-check time); attestations are bound to a flight hash and a nullifier. | — |
| **Double claims** | Per-product nullifiers `H(enclave_salt ‖ airline ‖ booking_ref)` stored on-chain; consumed atomically with claim verification; released only when the follow-up purchase fails. Same booking cannot claim two caps; it can have one cap and one drop (different products). | Two different bookings for the same trip by colluding users are two bookings. |
| **Cancel after claim** | Non-refundable fares pay at once; refundable/unknown fares are held until a **live** check (booking-page fetch by the enclave or manage-booking login) at `departure − final_check_lead`; an email is refused for that check (D27); cancelled ⇒ voided. | If the final check never happens, the payout stays held (no loss to LPs). |
| **Confirmation trading** (claiming with someone else's booking) | Passenger binding (D25): the policy stores a salted commitment to the lead passenger; the enclave recomputes it from the booking and the contract requires a match. | Users who name a friend as lead passenger can still use that friend's booking; per-user limits and the activation delay bound the gain. |
| **Faked booking pages** | The extension never vouches for page content: it only passes the page link. The enclave fetches the page itself from an allowlisted origin (HTTPS in production) and parses it. | A compromised booking site, or a DNS/TLS compromise of it, could feed false data; same TEE trust assumption as everywhere else. |
| **Adverse selection / informed buyers / groups** | Activation delay, deductible, max payout, momentum and seat-availability multipliers, utilisation surcharge, short quote validity, per-user per-flight and per-day limits, per-flight and per-route-week exposure caps. Drop purchases are refused once the price is already below the paid price. Backtest sensitivity in PRICING.md. | Many accounts acting together are limited only by the flight cap. Account creation is rate-limited per IP but not identity-bound. |
| **Per-flight concentration** | `flight_exposure_cap`, `route_week_exposure_cap`; utilisation surcharge per flight exposure. | Correlated events across routes (strikes, fuel) are not modelled. |
| **LP bank runs** | Deposits and withdrawals only at epochs; withdrawals reserve value at request time but can never take locked coverage; virtual shares against inflation attacks; premiums count as LP assets only when a policy resolves. Property-tested with random action sequences. | Withdrawers at an epoch leave the remaining LPs with the open risk. |
| **Async callback failures** | Every transfer has a callback that restores state (premium funding, payouts, refunds, credit withdrawals, LP claims, fee withdrawals); payouts move only the paid part out of locked coverage until confirmed, so a rollback never needs free liquidity. Tested natively and in the sandbox by blocking receivers on the mock token. | — |
| **Relayer abuse** | Only allowlisted contracts and methods; deposits limited to 1 yocto (`ft_transfer_call`) or a storage deposit; token transfers only to CapFare contracts; gas cap; per-account and per-IP quotas; account creation quota; snapshot submissions pre-verified. | Gas griefing within the quotas is possible; the relayer account balance is the budget. |
| **Extension supply chain** | No API permissions; one host permission; closed shadow root; no remote code; bundled with pinned dependencies; the extension never holds keys (purchases hand off to the web app, D16). | A malicious update via the Web Store account; mitigated by review and reproducible builds (to do). |
| **PII leakage** | Inputs sealed in the browser to the enclave's X25519 key; web server only proxies ciphertext; logs redact PII-looking keys; attestations contain no names, emails or references (tested); IBANs masked before use, not stored. | The demo fixture endpoint returns synthetic booking references (demo only). |
| **Admin key misuse** | Parameters and enclave keys change only after a timelock (`param_timelock_secs`, `key_timelock_secs`) with events; `set_paused` only stops new sales; the vault's registry cannot change while positions are open. Revocation and pause are immediate by design. | The owner could propose bad parameters; anyone watching events has the timelock to react (LPs can request withdrawal). |
| **Front-running a quote** | The contract recomputes the premium at purchase from the latest snapshot; the buyer sets `max_premium_minor`. | — |
| **Small-order ed25519 keys** | Off-chain verification uses strict mode (`zip215: false`); on-chain only registered keys are accepted. | — |

## Out of scope for the prototype

Mainnet deployment, real money, regulatory approval, a signed FX feed, on-chain TDX quote
verification, production airline data agreements.
