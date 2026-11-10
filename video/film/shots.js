/**
 * Footage plan per beat: which part of which take plays in the browser frame.
 * from/to are seconds on the take's compressed timeline (waits for the chain cut out; see
 * video/render/inspect.py <take>). len is screen time (defaults to to - from; shots are fitted
 * into the beat). crop: omitted = automatic camera following the clicks; {w, bias, y} tunes it;
 * an array [[u, x, y, w], ...] sets keyframes by hand. x: false drops the shot in the X cut.
 * url: path shown in the browser's address pill.
 */
/** Numbers the graphics show, as they appear in these recordings. */
window.FACTS = { cap: 180, risen: 260, booked: 260, payout: 75, deductible: 5, maxPayout: 150, dropBooked: 220, dropNow: 195, dropPaid: 22, dropDeductible: 3 };

window.SHOTS = {
  find: [
    { take: "ext-search", from: 6.4, to: 10.6, len: 3.0, crop: { w: 1240, bias: 0.4 }, url: "/booker" },
    { take: "ext-search", from: 12.0, to: 16.6, len: 4.6, crop: [[0, 520, 300, 920], [0.35, 520, 300, 920], [0.75, 560, 380, 880], [1, 560, 380, 880]], url: "/booker/results" },
  ],
  account: [{ take: "account", from: 2.4, to: 10.46, crop: { w: 1000, x0: 110 }, url: "/account" }],
  credit: [{ take: "topup", from: 2.6, to: 10.78, crop: { w: 1000, x0: 110, y: 430 }, url: "/credit" }],
  lock: [{ take: "buy-cap", from: 2.0, to: 15.76, crop: { w: 960, x0: 100 }, url: "/quote" }],
  choices: [
    { take: "options", from: 37.2, to: 43.2, len: 4.2, crop: { w: 900, x0: 120, y: 470 }, url: "/quote" },
    { take: "options", from: 45.3, to: 51.4, len: 4.2, crop: { w: 900, x0: 120, y: 560 }, url: "/quote" },
  ],
  alerts: [
    { take: "price-rise", from: 33.2, to: 44.6, len: 6.2, crop: { w: 1100, x0: 110 }, url: "/policies" },
    { take: "price-rise", from: 75.6, to: 82.8, len: 4.4, crop: { w: 1100, x0: 110 }, url: "/policies", x: false },
  ],
  claim: [
    { take: "book", from: 11.8, to: 15.6, len: 2.6, crop: { w: 1200, bias: 0.5 }, url: "/booker/flight", x: false },
    { take: "book", from: 28.8, to: 32.5, len: 2.4, crop: { w: 1200, bias: 0.5 }, url: "/booker/checkout" },
    { take: "claim", from: 35.0, to: 45.0, len: 5.6, crop: { w: 1000, x0: 110 }, url: "/claim/11" },
    { take: "claim-release", from: 40.3, to: 48.0, len: 4.4, crop: { w: 1000, x0: 110 }, url: "/claim/11" },
  ],
  verify: [
    { take: "reject", from: 7.0, to: 12.4, len: 3.6, crop: { w: 1000, x0: 110, y: 560 }, url: "/claim/13" },
    { take: "reject", from: 18.8, to: 23.6, len: 3.0, crop: { w: 1000, x0: 110, y: 560 }, url: "/claim/13", x: false },
    { take: "reject", from: 30.4, to: 35.4, len: 3.0, crop: { w: 1000, x0: 110, y: 560 }, url: "/claim/13" },
    { take: "binding", from: 36.0, to: 41.7, len: 3.4, crop: { w: 1000, x0: 110, y: 520 }, url: "/verify" },
  ],
  flex: [
    { take: "route", from: 31.4, to: 37.6, len: 4.0, crop: { w: 960, x0: 100 }, url: "/quote" },
    { take: "route", from: 40.1, to: 46.6, len: 4.2, crop: { w: 1000, x0: 100 }, url: "/quote" },
    { take: "route", from: 51.0, to: 54.9, len: 2.6, crop: { w: 1000, x0: 100 }, url: "/quote" },
  ],
  drop: [
    { take: "drop-buy", from: 30.2, to: 37.6, len: 3.2, crop: [[0, 340, 280, 1100], [0.55, 340, 330, 1100], [1, 440, 380, 1000]], url: "/booker/confirmation" },
    { take: "drop-buy", from: 74.2, to: 82.27, len: 2.8, crop: { w: 1000, x0: 110 }, url: "/quote" },
    { take: "drop-fall", from: 4.0, to: 11.9, len: 2.2, crop: { w: 1000, x0: 110 }, url: "/policies", x: false },
    { take: "drop-settle", from: 13.4, to: 18.29, len: 2.2, crop: { w: 1000, x0: 110, y: 330 }, url: "/claim/18" },
  ],
  renew: [
    { take: "held", from: 31.8, to: 38.2, len: 3.0, crop: { w: 1000, x0: 110, y: 470 }, url: "/verify" },
    { take: "held", from: 44.6, to: 48.6, len: 2.0, crop: { w: 1000, x0: 110, y: 330 }, url: "/policies", x: false },
    { take: "renew", from: 34.4, to: 37.4, len: 2.0, crop: { w: 1000, x0: 110, y: 640 }, url: "/policies" },
    { take: "renew", from: 67.0, to: 72.39, len: 2.6, crop: { w: 1000, x0: 110, y: 330 }, url: "/policies" },
  ],
  travellers: [
    { take: "return-buy", from: 5.6, to: 12.6, len: 3.0, crop: { w: 1000, x0: 110 }, url: "/quote" },
    { take: "return-claim", from: 49.8, to: 53.2, len: 2.0, crop: [[0, 120, 60, 1100], [1, 120, 120, 1100]], url: "/booker/manage", x: false },
    { take: "return-claim", from: 79.6, to: 84.7, len: 2.4, crop: { w: 1000, x0: 110, y: 420 }, url: "/verify" },
    { take: "return-paid", from: 44.2, to: 47.8, len: 2.4, crop: { w: 1000, x0: 110, y: 300 }, url: "/policies" },
  ],
  payout: [
    { take: "credit-out", from: 23.4, to: 28.6, len: 2.6, crop: { w: 1000, x0: 110 }, url: "/credit" },
    { take: "credit-out", from: 28.9, to: 35.6, len: 3.0, crop: { w: 1000, x0: 110 }, url: "/credit" },
    { take: "credit-out", from: 38.4, to: 45.64, len: 3.4, crop: { w: 1000, x0: 110 }, url: "/credit" },
  ],
  lp: [
    { take: "lp", from: 0.4, to: 6.6, len: 3.0, crop: { w: 1000, x0: 110, y: 380 }, url: "/lp" },
    { take: "lp", from: 7.4, to: 13.45, len: 3.4, crop: { w: 1000, x0: 110, y: 380 }, url: "/lp" },
    { take: "lp", from: 15.3, to: 16.9, len: 2.2, crop: { w: 1000, x0: 110, y: 400 }, url: "/lp" },
  ],
  transparency: [
    { take: "transparency", from: 2.0, to: 9.0, len: 4.0, crop: { w: 1040, x0: 110, y: 450 }, url: "/transparency" },
    { take: "transparency", from: 17.0, to: 25.79, len: 5.4, crop: { w: 1100, x0: 110, y: 470 }, url: "/transparency" },
  ],
  extras: [
    { take: "extras", from: 6.4, to: 12.4, len: 3.4, crop: { w: 1000, x0: 110 }, url: "/quote" },
    { take: "extras", from: 16.0, to: 22.5, len: 3.8, crop: { w: 1000, x0: 110 }, url: "/quote" },
  ],
};
