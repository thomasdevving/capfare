/* CapFare service worker: shows alert notifications (web push) and opens the app on click. */
self.addEventListener("push", (event) => {
  let a = { title: "CapFare", body: "", url: "/policies", tag: "capfare" };
  try {
    a = { ...a, ...event.data.json() };
  } catch {
    /* plain text or empty push */
  }
  event.waitUntil(
    self.registration.showNotification(a.title, { body: a.body, tag: a.tag, icon: "/icon.svg", badge: "/icon.svg", data: { url: a.url } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/policies";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url === url && "focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
