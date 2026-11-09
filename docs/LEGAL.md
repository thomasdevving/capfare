# Legal note

* CapFare in this repository is a **testnet prototype**. It uses test USDC without value. No
  real money is accepted or paid out; fiat top-ups and IBAN payouts are simulated by
  `MockRampProvider`; NEAR Intents is only used for dry-run quotes.
* CapFare is described as **price protection**, not insurance. Depending on the jurisdiction,
  a product that pays out on an uncertain future price movement in exchange for a premium may
  be regulated as insurance or as a financial instrument. A commercial launch would require
  partnering with a **licensed insurer** (or another appropriately licensed financial
  partner) who carries the product, and a **licensed payment / e-money provider** for euro
  top-ups (iDEAL, cards) and SEPA payouts. Liquidity provision by the public may itself be a
  regulated activity.
* **Airline and travel-site terms.** Automated access to airline booking flows is generally
  not permitted without agreement. This prototype ships no live airline scraper (D12, D14);
  the price adapters for KLM and Transavia are demo-only. Live data requires a data agreement
  or a licensed offer API.
* **Personal data.** Booking emails and references are processed only inside the booking
  checker; the chain stores no personal data. A production service needs a DPIA, a data
  processing agreement with the TEE host, and a privacy notice.
* **Ramp adapter skeleton.** `web/lib/ramp.ts` documents the interface a licensed provider
  must implement (`createTopUp`, `createPayout`, signed webhooks).
* No trademark affiliation: KL1695 and airport codes are used as factual examples; the demo
  booking site is a fictitious "Skyline Travel (demo)".
