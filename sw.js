self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text() || 'Nexo tiene una novedad para usted.' }; }
  const title = data.title || 'Nexo tiene algo para usted';
  const options = {
    body: data.body || 'Revise su catálogo y sus opciones.',
    icon: data.icon || 'fotos/arte-nexo.png',
    badge: data.badge || 'fotos/arte-nexo.png',
    tag: data.tag || 'nexo-update',
    renotify: false,
    data: { url: data.url || './#catalogo' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#catalogo', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const existing = list.find(client => 'focus' in client);
    if (existing) { existing.navigate(target); return existing.focus(); }
    return clients.openWindow(target);
  }));
});
