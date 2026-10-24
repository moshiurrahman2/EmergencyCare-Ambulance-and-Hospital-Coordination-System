self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: "EmergencyCare update", body: event.data?.text() || "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "EmergencyCare update", {
      body: data.body || "You have a new trip update.",
      icon: "/medical-icon.svg",
      badge: "/medical-icon.svg",
      data: { url: data.url || "/" },
      tag: "emergencycare-trip-update",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existingClient) {
        existingClient.navigate(destination);
        return existingClient.focus();
      }
      return self.clients.openWindow(destination);
    }),
  );
});
