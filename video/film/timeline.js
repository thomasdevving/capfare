/**
 * The film's single source of truth: scenes ("beats") in order, their length in page seconds,
 * chapter titles, the voice-over / on-camera lines (also burned in as captions), webcam
 * placeholders, and which beats (and lines) make the 2:20 cut for X.
 *
 * Used by film.html (rendering), render/export.cjs (script, captions, webcam table, cues).
 *
 * vo: [{ t: text, cam?: true }]  cam = said on camera (webcam visible), else voice-over.
 * x:  false = not in the X cut; { dur, vo } = shorter version for X; true = same in both.
 * cam: webcam placeholder for this beat: { kind: "large" | "pip", at: [x, y, w, h], round?, from?, to? }
 *      (with to set, a PiP shows only while the on-camera lines are said)
 */
(function (root) {
  const BEATS = [
    {
      id: "intro", dur: 9.5, bg: "navy", cam: { kind: "large", at: [96, 120, 860, 760] },
      vo: [
        { t: "You find a flight for 170 euros. A day later, the same seat costs 260.", cam: true },
        { t: "Or you book, and the next morning it's cheaper.", cam: true },
      ],
      x: { dur: 8.5 },
    },
    {
      id: "logo", dur: 5.5, bg: "yellow",
      vo: [{ t: "CapFare locks the price of your flight, wherever you book. It runs on NEAR." }],
      x: { dur: 5 },
    },
    {
      id: "find", dur: 9, bg: "light", kicker: "01 · Chrome extension", title: "The CapFare Chrome extension recognises your flight",
      vo: [{ t: "The CapFare extension recognises the flight on any booking site. Here, on our demo site, it offers to lock a maximum price." }],
      x: { dur: 7, vo: [{ t: "The extension recognises the flight on any booking site and offers to lock a maximum price." }] },
    },
    {
      id: "account", dur: 8, bg: "navy", kicker: "02 · Account", title: "A passkey, a readable name, no gas",
      vo: [{ t: "No wallet, no seed phrase. A passkey creates a readable NEAR account, and the relayer pays every gas fee." }],
      x: { dur: 7, vo: [{ t: "A passkey creates a readable NEAR account. No seed phrase, no gas, prepaid credit." }] },
    },
    {
      id: "credit", dur: 6, bg: "light", kicker: "03 · Credit", title: "Prepaid credit pays the premiums",
      vo: [{ t: "Premiums come from prepaid credit. The iDEAL top-up is simulated on testnet." }],
      x: false,
    },
    {
      id: "lock", dur: 10.5, bg: "navy", kicker: "04 · Price Cap", title: "Lock a maximum price before you book",
      vo: [{ t: "The premium comes from a public formula on the contract. Buying locks the full maximum payout in the vault before you pay." }],
      x: { dur: 8.5, vo: [{ t: "The premium comes from a public formula on-chain. The maximum payout is locked in the vault first." }] },
    },
    {
      id: "choices", dur: 9, bg: "light", kicker: "05 · Your choices", title: "Choose the deductible and how long the lock lasts",
      vo: [{ t: "You choose the deductible and how long the lock lasts, three to thirty days. A higher deductible costs less." }],
      x: { dur: 6.5, vo: [{ t: "Choose the deductible and a lock of three to thirty days." }] },
    },
    {
      id: "alerts", dur: 11, bg: "navy", kicker: "06 · Alerts", title: "The price passes your cap. You hear about it.",
      vo: [{ t: "Prices here come from a scripted demo source. When the price passes your cap, you get an alert in the app, by push or by email." }],
      x: { dur: 8, vo: [{ t: "When the demo price passes your cap, you get an alert in the app, by push or by email." }] },
    },
    {
      id: "claim", dur: 14, bg: "light", kicker: "07 · Book and claim", title: "Book anywhere. Claim the difference.",
      vo: [{ t: "Book anywhere, then claim with the original email. Bookings can often be cancelled free for a day, so the payout waits for a live check of the booking. Then it's paid from the vault." }],
      x: { dur: 12, vo: [{ t: "Claim with the original email. The payout waits for a live check of the booking after a day, then it's paid from the vault." }] },
    },
    {
      id: "verify", dur: 13, bg: "navy", kicker: "08 · Verification", title: "Only the flight, fare and price reach the chain",
      vo: [{ t: "Bookings are checked by a verifier built for a hardware enclave. Only the flight, fare and price reach the chain. Edited or forwarded emails, reused bookings and someone else's booking are refused." }],
      x: { dur: 9, vo: [{ t: "Only the flight, fare and price reach the chain. Edited emails, reused bookings and other people's bookings are refused." }] },
    },
    {
      id: "drop", dur: 10, bg: "light", kicker: "09 · Drop Guarantee", title: "Just booked? Covered if it gets cheaper",
      vo: [{ t: "Just booked? The Drop Guarantee pays the difference if the same flight gets cheaper during its window." }],
      x: { dur: 7, vo: [{ t: "Just booked? The Drop Guarantee pays if the same flight gets cheaper." }] },
    },
    {
      id: "flex", dur: 11, bg: "navy", kicker: "10 · Flexible cover", title: "Any flight on your route, days and airports",
      vo: [{ t: "Not sure which flight or day? Route cover pays against the cheapest fare on the route, up to three days either side, and from nearby airports." }],
      x: { dur: 8, vo: [{ t: "Route cover pays against the cheapest fare, up to three days either side and from nearby airports." }] },
    },
    {
      id: "travellers", dur: 9.5, bg: "light", kicker: "11 · Travellers and return trips", title: "Up to nine travellers. Both flights at once.",
      vo: [{ t: "One policy covers up to nine travellers. A return trip is bought as one, and one booking claims both flights." }],
      x: { dur: 7, vo: [{ t: "Up to nine travellers on one policy, and a return trip bought as one." }] },
    },
    {
      id: "renew", dur: 9.5, bg: "navy", kicker: "12 · Refunds and renewals", title: "Refundable tickets, and renewals without a gap",
      vo: [{ t: "Refundable tickets get their final check just before departure. And a Price Cap can be renewed without a gap." }],
      x: false,
    },
    {
      id: "payout", dur: 10, bg: "light", kicker: "13 · Your payout", title: "Withdraw, cash out, or another asset",
      vo: [{ t: "Payouts arrive as test USDC. Withdraw them, send them to a bank account through a simulated ramp, or quote another asset with NEAR Intents." }],
      x: false,
    },
    {
      id: "lp", dur: 10, bg: "navy", kicker: "14 · Liquidity providers", title: "Two vaults. Every policy fully collateralised.",
      vo: [{ t: "Liquidity providers fund two separate vaults, one per product. Deposits and withdrawals settle per epoch, and every policy is fully collateralised." }],
      x: { dur: 8, vo: [{ t: "Liquidity providers fund two vaults. Every policy is fully collateralised." }] },
    },
    {
      id: "transparency", dur: 10, bg: "light", kicker: "15 · Transparency", title: "Anyone can check the numbers",
      vo: [{ t: "Everything is public: parameters, collateral, prices and service keys. On testnet the services still use development keys, and the page says so." }],
      x: false,
    },
    {
      id: "extras", dur: 8.5, bg: "navy", kicker: "16 · Extras", title: "Paste a link. Watch a price for free.",
      vo: [{ t: "Paste a link from any booking site, or watch a price for free and get an alert when it moves." }],
      x: false,
    },
    {
      id: "near", dur: 33, bg: "ink", kicker: "17 · How CapFare uses NEAR", title: "Why NEAR",
      cam: { kind: "pip", at: [72, 812, 220, 220], round: true, from: 0, to: "cam lines" },
      vo: [
        { t: "Why NEAR? Users never touch gas. They sign meta-transactions and our relayer submits them.", cam: true },
        { t: "Accounts are readable names, created by the relayer." },
        { t: "Premiums, payouts and deposits move as NEP-141 tokens with transfer-and-call." },
        { t: "Every step that moves money is an async cross-contract call, with a callback that rolls back on failure." },
        { t: "Price snapshots and booking attestations are verified on-chain with ed25519 signatures." },
        { t: "And everything is on the public explorer." },
      ],
      x: {
        dur: 22,
        vo: [
          { t: "Why NEAR? Gasless meta-transactions through our relayer, and readable named accounts.", cam: true },
          { t: "NEP-141 tokens, async cross-contract calls that roll back on failure, and ed25519 checks on-chain." },
          { t: "All on the public explorer." },
        ],
      },
    },
    {
      id: "status", dur: 12.5, bg: "navy", cam: { kind: "pip", at: [1240, 300, 560, 560], round: false },
      vo: [
        { t: "I built CapFare because a flight price is the one thing on a trip you can't plan for.", cam: true },
        { t: "It's a testnet prototype: live contracts, demo prices, and services not in an enclave yet.", cam: true },
      ],
      x: { dur: 8, vo: [{ t: "It's a testnet prototype: live contracts, demo prices, services not in an enclave yet.", cam: true }] },
    },
    {
      id: "end", dur: 6, bg: "yellow", cam: { kind: "pip", at: [1560, 760, 260, 260], round: true },
      vo: [{ t: "CapFare. Built at the NEAR Hackathon.", cam: true }],
      x: { dur: 5 },
    },
  ];

  /** Beats of one cut with their start times (seconds), durations and lines. */
  function cut(name) {
    let t = 0;
    const out = [];
    for (const b of BEATS) {
      let dur = b.dur;
      let vo = b.vo;
      if (name === "x") {
        if (b.x === false) continue;
        if (b.x && typeof b.x === "object") {
          dur = b.x.dur ?? dur;
          vo = b.x.vo ?? vo;
        }
      }
      out.push({ ...b, start: t, dur, vo });
      t += dur;
    }
    return { beats: out, duration: t };
  }

  /**
   * Caption chunks for a beat: short lines spread over the speaking time, by word count.
   * A line breaks after a sentence (5+ words) or a comma (8+ words); a run of 12 words or 75
   * characters is split at its last comma, else in the middle. Short leftovers join the line before.
   */
  function captions(beat) {
    const lines = [];
    for (const v of beat.vo) {
      const words = v.t.split(" ");
      const out = [];
      let chunk = [];
      for (const w of words) {
        chunk.push(w);
        const n = chunk.length;
        if (n >= 12 || chunk.join(" ").length > 74) {
          // Too long: break at the last comma or full stop, else in the middle.
          let k = -1;
          for (let i = n - 2; i >= 3; i--) if (/[,.?:;]$/.test(chunk[i])) { k = i; break; }
          if (k < 0) k = Math.ceil(n / 2) - 1;
          out.push(chunk.slice(0, k + 1));
          chunk = chunk.slice(k + 1);
        }
        const m = chunk.length;
        if (m && ((/[.?!]$/.test(w) && m >= 5) || (/[,:;]$/.test(w) && m >= 8))) {
          out.push(chunk);
          chunk = [];
        }
      }
      if (chunk.length) {
        const prev = out[out.length - 1];
        if (prev && chunk.length < 3 && prev.length + chunk.length <= 14) prev.push(...chunk);
        else out.push(chunk);
      }
      for (const c of out) lines.push({ text: c.join(" "), cam: !!v.cam });
    }
    const total = lines.reduce((a, l) => a + l.text.split(" ").length, 0);
    const lead = 0.45, tail = 0.35;
    const span = Math.max(0.5, beat.dur - lead - tail);
    let t = lead;
    return lines.map((l) => {
      const d = (span * l.text.split(" ").length) / total;
      const c = { ...l, start: t, end: t + d };
      t += d;
      return c;
    });
  }

  const api = { BEATS, cut, captions };
  if (typeof module !== "undefined") module.exports = api;
  else root.TIMELINE = api;
})(typeof window !== "undefined" ? window : globalThis);
