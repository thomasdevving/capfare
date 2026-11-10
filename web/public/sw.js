/* CapFare service worker: shows alert notifications (web push) and opens the app on click.
 * An alert may carry a second, optional action (one-tap lock, if the account turned it on):
 * then the notification has two buttons. Tapping the notification itself always opens the
 * normal link, and browsers without notification buttons just show that. */
self.addEventListener("push", (event) => {
  let a = { title: "CapFare", body: "", url: "/policies", tag: "capfare" };
  try {
    a = { ...a, ...event.data.json() };
  } catch {
    /* plain text or empty push */
  }
  const actions = a.quick_url && a.quick_action ? [{ action: "quick", title: a.quick_action }, { action: "open", title: a.action || "Open" }] : [];
  event.waitUntil(
    self.registration.showNotification(a.title, {
      body: a.body,
      tag: a.tag,
      icon: "/icon.svg",
      badge: "/icon.svg",
      actions,
      data: { url: a.url, quick_url: a.quick_url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = (event.action === "quick" && d.quick_url) || d.url || "/policies";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url === url && "focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
