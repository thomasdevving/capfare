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
    h1a: "Protect your flight price.",
    h1b: "Before and after booking.",
    sub: "Set a price cap before you book, or cover a price drop after. Protect one exact flight or any flight on a route and day, one-way or return, for everyone on the booking, with a deductible and payout limit agreed upfront.",
    ctaChrome: "Get the extension",
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
          "Travelling together or returning? One lock covers up to 9 travellers, and both flights of a return trip.",
          "No extension? Check a flight on this website does the same on your phone.",
        ],
      },
      {
        body: "Book the flight wherever you like: the airline's website, a travel agency or a comparison site. Just booked? The extension offers a Drop Guarantee: if the same flight gets cheaper within 7 days, you get the difference.",
        points: (_d: number): string[] => [
          "Coverage follows the flight, not the website.",
          "Your booking itself stays between you and the airline.",
          "Alerts by push or email tell you when the price passes your cap, so you know when to book.",
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
      body: "Lock a maximum price for 7 days. If the price rises, claim the eligible difference after booking.",
      example: (d: number, m: number) =>
        `Book at €255 with a €180 cap and ${eur(d)} deductible: ${eur(Math.max(0, Math.min(25500 - 18000 - d, m)))} back.`,
    },
    drop: {
      name: "Drop Guarantee",
      when: "Right after you book",
      body: "Already booked? If the same flight gets cheaper within 7 days, claim the eligible difference.",
      example: (d: number, m: number) =>
        `Book at €220, then the price drops to €195. After a ${eur(d)} deductible: ${eur(Math.max(0, Math.min(22000 - 19500 - d, m)))} back.`,
    },
    paramsNote: (live: boolean): string => (live ? "Deductibles and maximums are the current contract parameters." : "Deductibles and maximums shown are example parameters."),
  },
  anywhere: {
    title: "Book where you want",
    body: [
      "Protection follows the flight, date and fare class on your verified booking.",
      "Try the extension on Skyline Travel, our demo booking site. Airline integrations are in progress.",
    ],
  },
  payout: {
    title: "Your payout already exists",
    body: "Your maximum payout is reserved in a vault before you pay. Check the live balances below.",
    rows: { assets: "Money in the vaults", locked: "Locked for active policies", active: "Active policies", solvency: "Solvency check" },
    solvencyDetail: "money in the vaults ≥ locked + pending withdrawals",
    passed: "Passed",
    failed: "Failed",
    loading: "Loading live figures…",
    error: (t: string | null): string => (t ? `We couldn't load live vault data. Last updated ${t}.` : "We couldn't load live vault data. Try again in a minute."),
    stale: (t: string) => `Live data is delayed. Last updated ${t}.`,
    updated: (t: string) => `Updated ${t}`,
    link: "View vault details",
    sumNote: "Both vaults, in test USDC.",
  },
  privacy: {
    title: "Your booking stays private",
    body: [
      "Your confirmation is encrypted on your device. Only flight details and a passenger fingerprint are sent to the blockchain.",
    ],
    note: "This demo uses development keys; hardware-enclave verification is not active yet.",
  },
  fine: {
    title: "Policy details",
    items: [
      "Coverage is for one exact flight, date, fare class and airport pair, or (route cover) any flight CapFare tracks on that route and day in that fare class, paid against the cheapest fare. Anything else is not covered.",
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
    body: "Fund the protection vaults and earn premiums. Deposits and withdrawals settle once per epoch.",
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
