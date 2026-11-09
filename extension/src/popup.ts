chrome.runtime.sendMessage({ type: "app-url" }, (r: { url: string }) => {
  const a = document.getElementById("app") as HTMLAnchorElement;
  a.href = r.url;
});
