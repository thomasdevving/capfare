import json
from align2 import align
W = [
 ("p1", 0.8, 6.8, "hi my name's thomas and i built capfare so let's say you find a flight for one seventy euros"),
 ("p1", 6.8, 12.4, "a day later the same seat costs two hundred sixty euros or you book the next morning it's cheaper"),
 ("p1", 12.6, 18.0, "capfare locks the price of your flight wherever you book and it runs on near"),
 ("p1", 18.1, 23.4, "the extension recognises the flight on any booking site and offers to lock a maximum price"),
 ("p1", 23.4, 29.3, "a passkey creates a readable near account no seed phrase no gas and prepaid credit"),
 ("p1", 29.3, 35.9, "the premium comes from a public formula onchain the maximum payout is locked in the vault first"),
 ("p1", 36.3, 39.9, "choose the deductible and a lock of three to thirty days"),
 ("p1", 40.2, 45.6, "when the low price passes your cap you get an alert in the app by push or by email"),
 ("p1", 46.0, 53.7, "claim with the original email the payout waits for a live check of the booking after a day then it's paid from the vault"),
 ("p1", 54.1, 62.6, "only the flight fare and price reach the chain edited emails reused bookings and other people's bookings are refused"),
 ("p1", 62.8, 68.0, "just booked the drop guarantee pays if the same flight gets cheaper"),
 ("p1", 68.4, 74.9, "route cover pays against the cheapest fare up to three days either side and from nearby airports"),
 ("p1", 75.1, 79.3, "up to nine travellers on one policy and a return trip bought as one"),
 ("p1", 79.6, 85.6, "liquidity providers fund two vaults every policy is fully collateralized"),
 ("p2", 1.6, 3.2, "so why near"),
 ("p2", 3.3, 10.4, "gasless meta transactions through our relayer and readable named accounts n e p one four one tokens"),
 ("p2", 10.3, 17.6, "async cross contract calls that roll back on failure and e d two five five one nine checks onchain"),
 ("p2", 17.6, 27.1, "all on the public explorer it's a testnet prototype live contracts demo prices but services not in an enclave yet"),
 ("p2", 27.2, 31.5, "so this is capfare built for the near hackathon"),
]
out = []
for src, a, b, t in W:
    sc, segs = align(src, a, b, t)
    ok = len(segs) == len(t.split())
    print(f"{src} {a}-{b} {'OK ' if ok else 'BAD'} {len(segs)}/{len(t.split())}  " + " ".join(f"{w}@{s}" for w, s, e in segs[:4]) + " ... " + " ".join(f"{w}@{e}" for w, s, e in segs[-2:]))
    out.append({"src": src, "win": [a, b], "text": t, "words": segs})
json.dump(out, open("words.json", "w"), indent=1)
