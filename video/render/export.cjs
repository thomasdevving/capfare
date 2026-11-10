/**
 * Writes the film's paperwork from timeline.js and the render metadata (video/out/<cut>/meta.json,
 * written by render.cjs):
 *
 *   video/SCRIPT.md          per scene, with timecodes, on camera vs voice-over, caption lines
 *   video/CHECKLIST.md       every feature and scenario with its timecodes in both cuts
 *   video/WEBCAM.md          webcam placeholder table (timecodes, position, size, shape)
 *   video/captions-<cut>.srt burned-in captions as subtitles
 *   video/webcam-<cut>.json  webcam rects for compositing (1920x1080 px)
 *   video/cues-<cut>.json    sound-effect cues and voice-over spans
 *
 *   node video/render/export.cjs
 */
const fs = require("fs");
const path = require("path");
const TL = require("../film/timeline.js");

const ROOT = path.join(__dirname, "..");
const meta = (cut) => JSON.parse(fs.readFileSync(path.join(ROOT, "out", cut, "meta.json"), "utf8"));
const CUTS = ["full", "x"].filter((c) => fs.existsSync(path.join(ROOT, "out", c, "meta.json")));
const M = Object.fromEntries(CUTS.map((c) => [c, meta(c)]));

const mmss = (t) => {
  const d = Math.round(t * 10);
  return `${Math.floor(d / 600)}:${((d % 600) / 10).toFixed(1).padStart(4, "0")}`;
};
const srtT = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
// The NEAR chapter's sections start when the voice-over reaches them (same rule as film.js).
const NEAR_KEYS = [[/^Why$/], [/^Accounts$/, /^readable$/], [/^Premiums,$/], [/^Every$/, /^async$/], [/^Price$/, /^ed25519$/], [/^And$/, /^All$/]];
function wordTime(beat, re) {
  for (const c of TL.captions(beat)) {
    const ws = c.text.split(" ");
    const i = ws.findIndex((w) => re.test(w));
    if (i >= 0) return c.start + ((c.end - c.start) * i) / ws.length;
  }
  return null;
}
function nearSpan(cut, k) {
  const beat = TL.cut(cut).beats.find((b) => b.id === "near");
  if (!beat) return "not in this cut";
  const starts = NEAR_KEYS.map((ks) => { for (const re of ks) { const t = wordTime(beat, re); if (t != null) return Math.max(0.2, t - 0.3); } return null; });
  if (starts[k] == null) return "in the receipts (next row)";
  const next = starts.slice(k + 1).find((x) => x != null) ?? beat.dur;
  return `${mmss(beat.start + starts[k])}–${mmss(beat.start + next)}`;
}
const span = (cut, id) => {
  if (/^near:\d$/.test(id)) return nearSpan(cut, Number(id.slice(5)));
  const b = M[cut]?.beats.find((x) => x.id === id);
  return b ? `${mmss(b.start)}–${mmss(b.start + b.dur)}` : "not in this cut";
};
const NAMES = { intro: "Opening (on camera)", logo: "CapFare in one line", near: "17 · How CapFare uses NEAR", status: "Why I built it, honest status (on camera)", end: "End card" };

// ---------------------------------------------------------------- SCRIPT.md
let s = `# CapFare demo film: script\n\nGenerated from \`video/film/timeline.js\` by \`video/render/export.cjs\`. Timecodes are\nm:ss.s from the start of each cut. **CAM** = said on camera (webcam placeholder visible),\n**VO** = voice-over. Each line is burned in as captions in the chunks listed under it.\n\n`;
for (const cut of CUTS) {
  s += `## ${cut === "full" ? "Full version" : "X cut"} (${mmss(M[cut].duration)})\n\n`;
  const { beats } = TL.cut(cut);
  for (const b of beats) {
    const mb = M[cut].beats.find((x) => x.id === b.id);
    const title = b.kicker ? `${b.kicker}: ${b.title}` : NAMES[b.id] ?? b.id;
    s += `### ${mmss(mb.start)}–${mmss(mb.start + mb.dur)}  ${title}\n\n`;
    const caps = M[cut].vo.filter((v) => v.beat === b.id);
    for (const v of b.vo) {
      const mine = caps.filter((c) => v.t.includes(c.text.split(" ").slice(0, 3).join(" ")) || v.t.includes(c.text));
      const t0 = mine.length ? mine[0].start : mb.start, t1 = mine.length ? mine[mine.length - 1].end : mb.start + mb.dur;
      s += `- **${v.cam ? "CAM" : "VO"}** ${mmss(t0)}–${mmss(t1)}: ${v.t}\n`;
      for (const c of mine) s += `  - \`${mmss(c.start)}\` ${c.text}\n`;
    }
    s += `\n`;
  }
}
fs.writeFileSync(path.join(ROOT, "SCRIPT.md"), s);

// ---------------------------------------------------------------- CHECKLIST.md
const FEATURES = [
  ["Problem: prices jump after you find a flight, or drop after you book", "intro"],
  ["Browser extension recognises the flight on any booking site (shown on the Skyline Travel demo site)", "find"],
  ["Passkey sign-in that creates a readable NEAR account (name.capfare.testnet)", "account"],
  ["No seed phrase, no wallet, gas paid by the relayer", "account"],
  ["Prepaid credit; simulated iDEAL top-up on testnet", "credit"],
  ["Price Cap quote from the public on-chain premium formula", "lock"],
  ["Full maximum payout locked in the vault before the premium is paid", "lock"],
  ["Optional Drop Guarantee added at purchase (ticked in the footage)", "lock"],
  ["Choose the deductible (higher deductible, lower premium)", "choices"],
  ["Choose how long the lock lasts: 3, 7, 14 or 30 days", "choices"],
  ["Scripted demo price source, labelled as demo", "alerts"],
  ["Alert when the price passes the cap: in the app, push or email", "alerts"],
  ["Book anywhere (Skyline Travel demo booking with a test card)", "claim"],
  ["Claim with the original booking email", "claim"],
  ["24-hour free-cancellation rule: payout held until a live check of the booking", "claim"],
  ["Live check from the booking page link releases the payout from the vault", "claim"],
  ["Booking verifier built for a hardware enclave; only flight, fare and price reach the chain", "verify"],
  ["Refused: edited email (DKIM fails)", "verify"],
  ["Refused: forwarded email", "verify"],
  ["Refused: booking already used for a claim", "verify"],
  ["Refused: someone else's booking (another lead passenger)", "verify"],
  ["Drop Guarantee after booking: pays the difference if the price falls in its window", "drop"],
  ["Route cover: any flight on the route, against the cheapest fare", "flex"],
  ["Date window up to three days either side", "flex"],
  ["Nearby airports (airport groups such as AMS/RTM/EIN)", "flex"],
  ["Up to nine travellers on one policy", "travellers"],
  ["Return trip bought as one; one booking claims both flights", "travellers"],
  ["Refundable tickets: final check just before departure", "renew"],
  ["Renew a Price Cap without a gap", "renew"],
  ["Payouts in test USDC: withdraw to the wallet", "payout"],
  ["Cash out to a bank account through a simulated ramp", "payout"],
  ["Quote another asset with NEAR Intents (dry run)", "payout"],
  ["Liquidity providers: two vaults, deposits and withdrawals per epoch", "lp"],
  ["Every policy fully collateralised", "lp"],
  ["Transparency page: parameters, collateral, prices, service keys", "transparency"],
  ["Development keys on testnet, labelled as such", "transparency"],
  ["Paste a link from any booking site", "extras"],
  ["Watch a price for free", "extras"],
  ["NEAR: gasless meta-transactions through the relayer (real transaction shown)", "near:0"],
  ["NEAR: readable named accounts created by the relayer", "near:1"],
  ["NEAR: NEP-141 tokens with ft_transfer_call", "near:2"],
  ["NEAR: async cross-contract calls with rollback callbacks (real receipts shown)", "near:3"],
  ["NEAR: ed25519 signatures verified on-chain (contract code shown)", "near:4"],
  ["NEAR: every contract on the public explorer", "near:5"],
  ["Honest status: testnet prototype, demo prices, services not in an enclave yet", "status"],
  ["Built at the NEAR Hackathon, repository link", "end"],
];
let c = `# CapFare demo film: feature checklist\n\nGenerated by \`video/render/export.cjs\`. Timecodes are the scene that shows each feature.\n\n| # | Feature or scenario | Full version | X cut |\n|---|---|---|---|\n`;
FEATURES.forEach(([f, id], i) => (c += `| ${i + 1} | ${f} | ${span("full", id)} | ${span("x", id)} |\n`));
fs.writeFileSync(path.join(ROOT, "CHECKLIST.md"), c);

// ---------------------------------------------------------------- WEBCAM.md + json
let w = `# Webcam placeholders\n\nGenerated by \`video/render/export.cjs\`. Positions in pixels on the 1920x1080 frame (x, y = top-left).\nThe placeholder fades in from *start* to *full from* and out from *full until* to *end*. Replace it\nwith your camera recording: see "Compositing the webcam" in README.md.\n\n`;
for (const cut of CUTS) {
  w += `## ${cut === "full" ? "Full version" : "X cut"}\n\n| Scene | Kind | Start | Full from | Full until | End | x | y | w | h | Shape |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const k of M[cut].cam) w += `| ${k.beat} | ${k.kind} | ${mmss(k.start)} | ${mmss(k.fullStart ?? k.start)} | ${mmss(k.fullEnd ?? k.end)} | ${mmss(k.end)} | ${k.x} | ${k.y} | ${k.w} | ${k.h} | ${k.round ? "circle" : "rounded rect (r = 26 px)"} |\n`;
  w += `\n`;
  fs.writeFileSync(path.join(ROOT, `webcam-${cut}.json`), JSON.stringify(M[cut].cam, null, 1));
}
fs.writeFileSync(path.join(ROOT, "WEBCAM.md"), w);

// ---------------------------------------------------------------- captions + cues
for (const cut of CUTS) {
  const srt = M[cut].vo.map((v, i) => `${i + 1}\n${srtT(v.start)} --> ${srtT(v.end)}\n${v.text}\n`).join("\n");
  fs.writeFileSync(path.join(ROOT, `captions-${cut}.srt`), srt);
  fs.writeFileSync(path.join(ROOT, `cues-${cut}.json`), JSON.stringify({ cues: M[cut].cues, vo: M[cut].vo }, null, 1));
}
console.log("wrote SCRIPT.md, CHECKLIST.md, WEBCAM.md, captions/webcam/cues for", CUTS.join(", "));
