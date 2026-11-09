# Hackathon submission — DRAFT (not submitted)

Nothing here has been sent. The repository must be made public, the demo post published on
X by the team, and the form submitted by a human. Fill the placeholders first.

| Field | Value |
|---|---|
| Project name | CapFare |
| Lead's name | `<fill in>` |
| Contact email | `<fill in>` |
| Team size | `<fill in>` |
| Track(s) | `<choose from the live track list>` — suggested fit: consumer apps / DeFi / AI & TEE (check names on nearhackathon.com) |
| Mainnet NEAR payout account | `<fill in>.near` |
| Public repository | https://github.com/thomasdevving/capfare (currently private: make it public before the deadline, 2026-11-14 23:59 UTC) |
| Demo post on X | `<link after posting>` |
| Contact-notice consent | `<tick in the form>` |

## Description (≈1,050 characters)

CapFare is flight-price protection that works wherever you book. Lock a maximum price on one
exact flight, date and fare class (Price Cap), or protect a fresh booking against a price drop
(Drop Guarantee). If the airline's price goes above your cap before you book, you get the
difference back. Payouts come from two independent NEAR vaults funded by liquidity providers;
every policy's maximum payout is locked before the traveller pays, and anyone can check it
on-chain. Premiums come from a public on-chain formula fed by signed price snapshots. Booking
confirmations are encrypted on the user's device and checked by a TEE-designed verifier
(DKIM, nullifiers) that passes on only flight, fare and price. Users sign in with a passkey,
pay from prepaid credit and never pay gas (NEP-366 relayer). Includes Rust contracts with
property and sandbox tests (forced async failures), a Chrome extension, a web app, a
backtest that exports the premium parameters, and NEAR Intents dry quotes. Testnet/sandbox
prototype with test money; demo prices are scripted and labelled.

## X post draft (for the team to publish)

> Lock the price of your flight. Book wherever you want. ✈️
>
> CapFare: if the price goes up before you book, you get the difference back — paid from a
> fully collateralised vault on @NEARProtocol. Passkey sign-in, no gas, private booking checks.
>
> Testnet prototype, demo prices scripted. #NEARHackathon
> [attach: 2-min demo video or the landing + extension screenshots in docs/img/landing]
