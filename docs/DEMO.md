# Demo

## Scripted demo (reproducible)

```bash
./scripts/demo.sh
```

Builds what is missing, starts a local NEAR sandbox, deploys the contracts (demo parameters:
20-second activation delay, 90-second drop window), starts the price oracle and booking
verifier in demo mode and the relayer, then runs section 13 of the brief step by step and
prints vault state and the invariant check. Prices move because the **scripted demo price
source** replays `tee/price_oracle/demo/price_paths.json`; every snapshot it produces is tagged
`source_id = "demo"`. Booking confirmations are **synthetic** DKIM-signed test emails.

Expected end of the output:

```
▸ 7. Payout = min(260, 255) − 180 − deductible, capped at max payout
    payout                       €70 (expected €70) → state paid_out
▸ 8. Drop Guarantee: booked at €220, price falls to €195 within the window
    payout                       €22 (expected €22) → paid_out
▸ 9. Vault state and invariant
    cap_vault invariant          OK  (total_assets ≥ locked + pending)
DEMO OK
```

(Deductibles come from the backtest's parameter export; with the current export the cap
deductible is €5 and the drop deductible €3.)

## Two-minute video script

All on-screen prices that move are from the scripted demo source; the video says so twice.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:12 | Landing page hero; drag the cap line from €180 to €200 and back. | "CapFare lets you lock a maximum price on one exact flight, then book anywhere. If the price goes up, you get the difference. This is an example flight; the premium is computed with the same public formula the contract uses." |
| 0:12–0:30 | Chrome with the extension, on the demo booking site search page; overlay appears. | "Here's the extension on a booking page. It recognises KL1695 Amsterdam–Barcelona, Economy Light at €170, and offers a cap at €185. The price on the page is only a hint; the quote uses the signed oracle price." |
| 0:30–0:50 | Click "Lock this price" → web app quote; create account with a passkey; top up €20 (simulated iDEAL); buy. | "No wallet, no seed phrase: a passkey account, prepaid credit, and the relayer pays the gas. Buying locks the €150 maximum payout in the cap vault before I pay." |
| 0:50–1:05 | Transparency page: locked coverage, solvency check; then Policies with the activation countdown. | "Anyone can check that the money for this payout exists. The cap starts after a short activation delay — twenty seconds in this demo." |
| 1:05–1:20 | Policies → "Demo: next scripted price" until €260 (label visible). | "Now the demo price source raises the airline price to €260. On a live deployment this would come from the airline's own price, fetched inside a secure enclave." |
| 1:20–1:45 | Claim page → demo confirmation at €255 → result panel €70 with breakdown. | "I booked at €255. I upload the confirmation; it's encrypted on my device and checked in the enclave, which only passes on flight, fare class and price. Payout: the lower of €260 and €255, minus my €180 cap, minus the €5 deductible: €70, paid from the vault." |
| 1:45–2:00 | Confirmation page of the demo site with the Drop Guarantee overlay; LP dashboard. | "Just booked? The Drop Guarantee pays if the price drops within seven days. Liquidity providers fund both vaults separately and can lose money. Everything here runs on testnet or a local sandbox with test money." |
