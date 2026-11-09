const eur = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export const en = {
  locale: "en" as const,
  htmlLang: "en",
  meta: {
    title: "CapFare — lock the price of your flight",
    description: "Lock a maximum price on one specific flight, book anywhere, and get the difference back. Testnet prototype on NEAR.",
  },
  nav: { how: "How it works", protection: "Protection", payout: "Your payout", faq: "FAQ", app: "Check a flight", switchTo: "Nederlands", switchHref: "/nl" },
  hero: {
    h1a: "Lock the price of your flight.",
    h1b: "Book wherever you want.",
    sub: "If the price goes up before you book, you get the difference back. The money for your payout is locked before you pay.",
    ctaChrome: "Add to Chrome",
    ctaCheck: "Check a flight",
    chromeNote: "Chrome extension: load it unpacked from the repository while it is in review.",
  },
  chart: {
    caption: "Example flight KL1695, Amsterdam to Barcelona on 14 June, Economy Light. The price was €170 when the cap was bought; the traveller booked at €255 when the airline asked €260.",
    cardMeta: "14 June 2027, Economy Light",
    exampleChip: "Example",
    yourCap: "Your cap",
    price: "Airline price",
    youGetBack: "You get back",
    premium: "Premium",
    deductible: "Deductible",
    maxPayout: "Max payout",
    activeAfter: "Starts after",
    hours: (h: number): string => (h === 1 ? "1 hour" : `${h} hours`),
    dragHint: "Drag the cap line, or focus it and use the arrow keys.",
    liveParams: (net: string) => `Premium from the public formula with live contract parameters (${net}).`,
    exampleParams: "Example parameters: live contract data could not be loaded.",
    sliderLabel: "Cap level",
    daysBefore: "days before booking",
    booked: "booked",
    alt: (cap: number, payout: number, premium: number) =>
      `Chart of an example flight. The price rises from €170 to €260 over two weeks. With a cap of ${eur(cap)} and a booking at €255, the payout is ${eur(payout)}. The premium for this cap is ${eur(premium)}.`,
  },
  how: {
    title: "How it works",
    features: [
      {
        body: "While you browse, the CapFare extension recognises the flight on the page and shows what it costs to lock a maximum price for that exact flight, date and fare class. The premium comes from the public formula on the blockchain; the price on the page is only a hint.",
        points: (d: number): string[] => [
          "You see the cap, premium, deductible (" + "€" + (d / 100).toFixed(0) + ") and maximum payout before you pay.",
          "The lock lasts 7 days and starts after a short activation delay.",
          "No extension? Check a flight on this website does the same on your phone.",
        ],
      },
      {
        body: "Book the flight wherever you like: the airline's website, a travel agency or a comparison site. Just booked? The extension offers a Drop Guarantee: if the same flight gets cheaper within 7 days, you get the difference.",
        points: (_d: number): string[] => [
          "Coverage follows the flight, not the website.",
          "Your booking itself stays between you and the airline.",
        ],
      },
      {
        body: "Upload your booking confirmation email, or open your booking page with the CapFare extension and press Verify with CapFare. The booking is checked inside a secure enclave and only the flight, fare class and price come back. For non-refundable tickets the payout leaves the vault straight away.",
        points: (d: number): string[] => [
          "Example: airline price €260, you paid €255, cap €180, deductible €" + (d / 100).toFixed(0) + ": you get €" + ((25500 - 18000 - d) / 100).toFixed(0) + ".",
          "Refundable tickets need one more live check of the booking before departure, because an email can't show a cancellation.",
        ],
      },
    ],
    steps: [
      { n: "1", title: "Lock a max price", body: "Choose the flight, date and fare class, set your maximum price and pay a small premium. The lock lasts 7 days." },
      { n: "2", title: "Book anywhere", body: "Book that flight on the airline's website or with any travel agency, whenever you are ready." },
      { n: "3", title: "Get the difference", body: "Upload your booking confirmation. If the airline's price was above your cap, the difference is paid to you." },
    ],
    shotAlt: [
      "Screenshot: search results on the demo booking site with the CapFare extension offering to lock a maximum price.",
      "Screenshot: the booking confirmation on the demo booking site with the CapFare extension offering a Drop Guarantee.",
      "Screenshot: the manage-booking page of the demo booking site with the CapFare extension offering Verify with CapFare.",
    ],
    stubLabels: ["Max price", "Booked", "Paid to you"],
  },
  products: {
    title: "Two kinds of protection",
    cap: {
      name: "Price Cap",
      when: "Before you book",
      body: "For when you are not ready to book yet. Lock a maximum price for up to 7 days.",
      example: (d: number, m: number) =>
        `Example: the price is €170 today and you lock €180. The price climbs to €260 and you book at €255. You get €255 − €180 − ${eur(d)} deductible = ${eur(Math.min(25500 - 18000 - d, m))}. A cap pays at most ${eur(m)}.`,
    },
    drop: {
      name: "Drop Guarantee",
      when: "Right after you book",
      body: "For when you have just booked. If the price of the same flight drops within 7 days, you get the difference.",
      example: (d: number, m: number) =>
        `Example: you booked at €220. In the next 7 days the airline's price for the same flight falls to €195. You get €220 − €195 − ${eur(d)} deductible = ${eur(Math.max(0, Math.min(22000 - 19500 - d, m)))}. A Drop Guarantee pays at most ${eur(m)}.`,
    },
    paramsNote: (live: boolean): string => (live ? "Deductibles and maximums are the current contract parameters." : "Deductibles and maximums shown are example parameters."),
  },
  anywhere: {
    title: "Book where you want",
    body: [
      "Coverage follows the flight, not the website. What counts is the flight number, date, airports and fare class on your booking confirmation, so you can book with the airline, a travel agency or a comparison site.",
      "The Chrome extension shows a quote while you browse. Today it works on Skyline Travel, the demo booking site that ships with CapFare; support for airline and travel-agency websites is in progress. On your phone, use Check a flight on this website.",
    ],
  },
  payout: {
    title: "Your payout already exists",
    body: "Before you pay, the maximum payout of your policy is locked in a vault. Anyone can check these figures on the blockchain.",
    rows: { assets: "Money in the vaults", locked: "Locked for active policies", active: "Active policies", solvency: "Solvency check" },
    solvencyDetail: "money in the vaults ≥ locked + pending withdrawals",
    passed: "Passed",
    failed: "Failed",
    loading: "Loading live figures…",
    error: (t: string | null): string => (t ? `We couldn't load live vault data. Last updated ${t}.` : "We couldn't load live vault data. Try again in a minute."),
    stale: (t: string) => `Live data is delayed. Last updated ${t}.`,
    updated: (t: string) => `Updated ${t}`,
    link: "See every number on the transparency page",
    sumNote: "Both vaults, in test USDC.",
  },
  privacy: {
    title: "We never see who you are",
    body: [
      "You upload your booking confirmation or type your booking reference. It is encrypted on your device and only opened inside a secure enclave: an isolated part of a processor that not even the server's operator can look into.",
      "The enclave passes on four things: the flight, the date, the fare class and the price. Your name, email address and booking reference never reach CapFare's servers or the blockchain.",
    ],
    note: "In this testnet prototype the services run with development keys, not in a hardware enclave yet. The transparency page shows which keys are registered.",
  },
  fine: {
    title: "The fine print, in plain words",
    items: [
      "Coverage is for one exact flight, date, fare class and airport pair. A different flight or fare class is not covered.",
      (h: number): string => `A Price Cap starts ${h === 1 ? "1 hour" : `${h} hours`} after you buy it. Bookings made before that do not count.`,
      "A deductible is taken off every payout, and each policy has a maximum payout. Both are shown before you pay.",
      (refund: boolean): string =>
        refund
          ? "We don't promise that seats stay available. If your fare class sells out while your cap is active and unused, your premium is refunded."
          : "We don't promise that seats stay available. If your fare class sells out, the cap simply cannot be used.",
      "Non-refundable tickets are paid out as soon as the claim is checked. Refundable tickets are paid after one more live check of the booking, from a day before departure: open your booking page with the CapFare extension, or paste its link. An email alone can't show that you didn't cancel.",
      "Only bookings for the lead passenger you named when buying can be used to claim.",
    ],
  },
  lp: {
    title: "For liquidity providers",
    body: "Liquidity providers fund the vaults and earn the premiums; payouts come out of the vaults. Deposits and withdrawals are processed once per epoch at a published share price, and every policy's maximum payout stays locked until it ends.",
    risk: "You can lose money: if many travellers are paid out, the vault shrinks.",
    link: "Open the LP dashboard",
  },
  faq: {
    title: "Questions",
    items: [
      { q: "What happens if I don't book?", a: "Nothing more happens. The cap expires after 7 days and the premium is not refunded, unless your fare class sold out while the cap was active." },
      { q: "What if the flight sells out?", a: "We don't cover availability. If the oracle sees your fare class sold out while your cap is active and unused, the premium goes back to your credit." },
      { q: "What if I cancel my booking?", a: "Then there is no payout. For refundable tickets we check one day before departure that the booking still exists before paying." },
      { q: "Which airlines work?", a: "Coverage works for any booking whose confirmation we can verify. In this prototype that is KLM-format confirmations (tested with synthetic examples). More airlines follow." },
      { q: "Why is there a deductible and an activation delay?", a: "They keep premiums low. Without them, people who already know a price is about to jump would buy protection seconds before booking, and everyone else would pay for that." },
      { q: "How do I get paid?", a: "To your CapFare balance in USDC by default. From there you can withdraw to a bank account (IBAN) through a licensed payment partner, or receive another digital asset. On testnet these are simulated." },
      { q: "How do you check my booking?", a: "Two ways. Upload the original confirmation email: its digital signature shows it came from the airline or travel site and wasn't changed. Or open your booking page with the CapFare extension and press Verify with CapFare: our checker loads that page straight from the booking site and sees the booking as it is now, including a cancellation. Either way only the flight, fare, price and a scrambled fingerprint of the lead passenger's name come back, so only your own booking can be used." },
      { q: "Is this insurance?", a: "No. It is a testnet prototype of price protection. A commercial launch would require a licensed insurer or another appropriately licensed partner." },
      { q: "Do I need crypto?", a: "No. You sign in with a passkey, pay with prepaid credit and never pay network fees. On testnet everything uses test money." },
    ],
  },
  footer: {
    testnet: "Testnet prototype. No real money is used.",
    notInsurance: "CapFare is price protection, not insurance. A commercial launch would require a licensed partner.",
    links: { github: "GitHub", docs: "Docs", transparency: "Transparency", x: "X", legal: "Legal", lp: "LP dashboard" },
  },
  app: {
    network: (n: string) => `Network: ${n}`,
  },
};

export type Dict = typeof en;
