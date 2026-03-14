/* ═══════════════════════════════════════════════════════════════════════════
   firebase-messaging-sw.js — Service Worker pour Firebase Cloud Messaging
   ═══════════════════════════════════════════════════════════════════════════ */

// Version du SDK Firebase — doit correspondre à celle installée (firebase@12.x)
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyC-x5t3L4R1uDIC4RzzRcNdFEPB2t12h-w',
  authDomain:        'syndic-copropriete-26420.firebaseapp.com',
  projectId:         'syndic-copropriete-26420',
  storageBucket:     'syndic-copropriete-26420.firebasestorage.app',
  messagingSenderId: '244824237262',
  appId:             '1:244824237262:web:0bdc6258852107dccb5c9f',
});

const messaging = firebase.messaging();

// ── Notification en arrière-plan ────────────────────────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw] Background message:', payload);

  const data  = payload.notification || payload.data || {};
  const title = data.title || 'SyndicPro';
  const body  = data.body  || 'Nouvelle notification';
  const icon  = data.icon  || '/favicon.ico';

  return self.registration.showNotification(title, {
    body,
    icon,
    badge: '/favicon.ico',
    data: payload.data || {},
    tag: data.tag || 'syndic-notification',
  });
});

// ── Clic sur la notification ────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.lienUrl || '/notification';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
