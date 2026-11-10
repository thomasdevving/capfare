/** Toolbar popup: check the current tab on demand (activeTab), or turn on automatic checks on
 *  every https site (optional host permission, asked for only when the user switches it on). */
const ANY_SITE = ["https://*/*"];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

chrome.runtime.sendMessage({ type: "app-url" }, (r: { url: string }) => {
  $<HTMLAnchorElement>("app").href = r.url;
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function showSeen() {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  const key = `tab:${tab.id}`;
  const s = (await chrome.storage.session.get(key))[key] as { label: string; offer: string | null } | null | undefined;
  if (!s) return;
  const what = { cap: "Price Cap offer shown", drop: "Drop Guarantee offer shown", verify: "booking check offered" }[s.offer ?? ""] ?? "no verified price yet";
  $("seen").textContent = `On this page: ${s.label} — ${what}.`;
  $("seen").hidden = false;
}

$("check").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => void (globalThis.__capfareManual = true) });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    window.close();
  } catch {
    $("status").textContent = "Chrome doesn't let extensions read this page (for example a browser or Web Store page).";
  }
});

const auto = $<HTMLInputElement>("auto");
chrome.permissions.contains({ origins: ANY_SITE }).then((on) => (auto.checked = on));
auto.addEventListener("change", async () => {
  // The background worker registers or removes the content script when the permission changes.
  const ok = auto.checked ? await chrome.permissions.request({ origins: ANY_SITE }) : await chrome.permissions.remove({ origins: ANY_SITE });
  if (!ok) auto.checked = !auto.checked;
  await chrome.runtime.sendMessage({ type: "sync" });
  $("status").textContent = auto.checked ? "On. Reload open booking tabs to check them." : "Off. CapFare reads a page only when you press Check this page.";
});

void showSeen();

export {};
