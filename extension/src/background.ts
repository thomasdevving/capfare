/** Service worker: talks to the CapFare app API (content scripts cannot, due to page CORS). */
declare const __APP_URL__: string;

chrome.runtime.onMessage.addListener((msg: { type: string; flight?: unknown; product?: string }, _sender, reply) => {
  if (msg.type === "quote") {
    fetch(`${__APP_URL__}/api/ext/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flight: msg.flight, product: msg.product ?? "cap" }),
    })
      .then(async (r) => reply({ ok: r.ok, data: await r.json() }))
      .catch((e) => reply({ ok: false, data: { error: String(e) } }));
    return true;
  }
  if (msg.type === "app-url") {
    reply({ url: __APP_URL__ });
    return false;
  }
  return false;
});
