# Landing page design plan

Job of the page: in ten seconds a traveller understands that they can **lock a maximum price
on one specific flight, book anywhere, and get the difference back — and that the money for
that payout already exists**.

## 1. First plan

### Colours (light scheme)

| Name | Hex | Role |
|---|---|---|
| Signal yellow | `#FFD100` | The single accent. Fills only (primary button, payout area in the chart, focus ring). Never text on white. |
| Graphite | `#1E2228` | Body text, headings, the cap line. 15.6:1 on white. |
| Slate | `#5A626E` | Secondary text, axis labels. 6.4:1 on white. |
| Fare blue | `#1D5FD1` | The price line in the chart and inline links. 5.9:1 on white. |
| Concourse | `#F2F3F0` | Alternate section surface, chart background. |
| Paper | `#FFFFFF` | Main surface. |

Dark scheme tokens: background `#121519`, surface `#1B1F25`, text `#F1F2EE`, slate `#A7AEB8`,
fare blue `#7FAEFF`, yellow unchanged (graphite text on yellow in both schemes).

### Type

* **Atkinson Hyperlegible Next** (variable, self-hosted via Fontsource). Designed by the
  Braille Institute for maximum character distinction (1/l/I, 0/O) — the same job airport
  signage does. One family, weights 400/600/750.
* Scale (rem): 0.875 · 1 · 1.125 · 1.375 · 1.75 · 2.5 · 3.25 (hero headline on desktop).
* Prices and figures use tabular numerals (`font-variant-numeric: tabular-nums`) so columns of
  euros line up like a departure board. No monospace.
* Body line length ≤ 68 characters (`max-width: 34em`).

### Wireframe (desktop)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ CapFare                         How it works  Protection  Vaults  FAQ   EN|NL │
├──────────────────────────────────────────────────────────────────────────────┤
│ Lock the price of your flight.          ┌───────────────────────────────────┐ │
│ Book wherever you want.                 │ Example flight: KL1695 AMS→BCN     │ │
│                                         │ 14 Jun · Economy Light             │ │
│ If the price goes up before you book,   │      price line ──────╱‾‾‾ €260    │ │
│ you get the difference back. The money  │ ═════ your cap €180 ═[drag]══════  │ │
│ for your payout is locked before you    │ ////// you get back €70 //////     │ │
│ pay.                                    │ premium €4.60 · deductible €5 ·    │ │
│                                         │ max payout €150 · example params   │ │
│ [ Add to Chrome ]  [ Check a flight ]   └───────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│ How it works   1 Lock a max price   2 Book anywhere   3 Get the difference    │
│                (boarding-pass stub) (confirmation)    (payout slip)           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Two kinds of protection   Price Cap (before booking) | Drop Guarantee (after) │
│                           worked example with numbers | worked example         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Book where you want — coverage follows the flight, not the website           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Your payout already exists   total assets | locked | active | solvency ✓  TESTNET │
├──────────────────────────────────────────────────────────────────────────────┤
│ We never see who you are · The fine print · For liquidity providers · FAQ    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Testnet notice · GitHub · Docs · Transparency · X · Legal                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Mobile (360 px): one column; the chart comes directly after the headline (before the
sub-line) because it *is* the explanation; CTAs stack full-width.

### Alignment rules

* 12-column grid, 1200 px max width, 24 px gutters; text blocks start on column 1, the chart
  spans columns 7–12 on desktop.
* One left edge per section; headings and body share it. No centred body text.
* Vertical rhythm in multiples of 8 px; sections separated by 96 px (desktop) / 64 px (mobile).
* Numbers right-aligned in tables; euro signs before amounts in both locales.

### Principles specific to CapFare

1. **One flight, one number.** Every example names a flight, a date, a fare class and an amount
   in euros. No abstract "save money" claims.
2. **Yellow means your money.** The accent appears only where the user acts (primary button)
   or where their payout is shown (chart fill). Nothing decorative is yellow.
3. **Show that the money exists.** Live vault figures read from the contracts, each marked
   Testnet, with a clear stale/error state — never placeholder numbers.
4. **Wayfinding over decoration.** Structure borrowed from signage and boarding passes
   (labels, stubs, separators); no illustrations of planes, no gradients, no glow.

## 2. Review against the brief (before coding)

| First-plan element | Problem | Revision |
|---|---|---|
| "How it works" as three cards with an icon each | Generic SaaS default; identical rounded cards with soft shadows is a listed tell. | Each step is a flat strip in the boarding-pass vernacular: a perforated stub edge, the step number set like a gate number, one sentence. No shadows. |
| A stats row under the hero ("€X locked · N policies") | "Big number with small label as the hero" is a listed tell; also duplicates section 4. | Removed from the hero. Live figures appear only in "Your payout already exists", in a table with the Testnet label per row. |
| Small all-caps labels above each heading ("PROTECTION", "VAULTS") | Listed tell (all-caps eyebrows). | Removed. Headings carry the meaning alone. |
| Highlighting "the difference" in yellow in the headline | Listed tell (accenting one word). | Headline is plain graphite. The yellow appears in the chart's payout area instead, where it carries information. |
| Meta line "KL1695 · AMS→BCN · 14 Jun · Economy Light" | Middle-dot meta strings are a listed tell. | Chart caption is a short sentence: "Example flight KL1695, Amsterdam to Barcelona on 14 June, Economy Light." |
| Fade-in on every section | Brief allows one orchestrated motion only. | Only the hero chart animates on load (price line draws, crosses the cap, payout area fills, figure appears). Respects `prefers-reduced-motion`. |
| Button text "Get started →" | Vague, and arrows appended to button text are a listed tell. | "Add to Chrome" and "Check a flight". |
| Airline logos in "Book where you want" | Brief forbids logos. | Text only, and only sites with working adapters (currently: the CapFare demo airline page and klm.com quote-only overlay; listed honestly). |
| Product comparison numbered 1/2 | Not a sequence. | Two columns with names, no numbers. |

What stays: the yellow-on-graphite primary button (wayfinding sign), the departure-board
tabular figures, and the chart as the single bold element.

## 3. Build critique

See the end of this file (screenshots and the element removed after review).
