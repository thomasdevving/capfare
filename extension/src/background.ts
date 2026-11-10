/** Service worker: talks to the CapFare app API (content scripts cannot, due to page CORS),
 *  keeps the "any site" content script in step with the optional permission, and marks the
 *  toolbar icon on tabs where CapFare has an offer. */
declare const __APP_URL__: string;

/** Granted only if the user turns on automatic checks in the popup (optional host permission). */
const ANY_SITE = ["https://*/*"];
const SCRIPT_ID = "capfare-any-site";
const appOrigin = new URL(__APP_URL__).origin;

async function syncAnySite() {
  const granted = await chrome.permissions.contains({ origins: ANY_SITE });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (granted && !existing.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: ANY_SITE,
        // The CapFare app itself is not a booking site; its demo site has the static script.
        excludeMatches: appOrigin.startsWith("https:") ? [`${appOrigin}/*`] : [],
        js: ["content.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  } else if (!granted && existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
}
chrome.runtime.onInstalled.addListener(() => void syncAnySite());
chrome.runtime.onStartup.addListener(() => void syncAnySite());
chrome.permissions.onAdded.addListener(() => void syncAnySite());
chrome.permissions.onRemoved.addListener(() => void syncAnySite());

type Seen = { label: string; offer: "cap" | "drop" | "verify" | null } | null;

chrome.runtime.onMessage.addListener((msg: { type: string; coverage?: unknown; flight?: unknown; product?: string; travellers?: number; state?: Seen }, sender, reply) => {
  if (msg.type === "quote") {
    const coverage = msg.coverage ?? { flight: msg.flight };
    fetch(`${__APP_URL__}/api/ext/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(coverage as object), product: msg.product ?? "cap", travellers: msg.travellers ?? 1 }),
    })
      .then(async (r) => reply({ ok: r.ok, data: await r.json() }))
      .catch((e) => reply({ ok: false, data: { error: String(e) } }));
    return true;
  }
  if (msg.type === "app-url") {
    reply({ url: __APP_URL__ });
    return false;
  }
  if (msg.type === "seen") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      const s = msg.state ?? null;
      void chrome.action.setBadgeText({ tabId, text: s?.offer ? "✓" : "" });
      void chrome.action.setBadgeBackgroundColor({ tabId, color: "#FFD100" });
      void chrome.action.setBadgeTextColor?.({ tabId, color: "#0B2447" });
      void chrome.storage.session.set({ [`tab:${tabId}`]: s });
    }
    reply({});
    return false;
  }
  if (msg.type === "sync") {
    syncAnySite().then(() => reply({}), () => reply({}));
    return true;
  }
  return false;
});
chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(`tab:${tabId}`));

export {};
