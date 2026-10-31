// Only shows notifications. It caches nothing and intercepts no requests.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Agent Intern', { body: data.body || '', data: { url: data.url || '/' }, icon: '/favicon.svg' }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
