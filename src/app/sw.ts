/// <reference lib="webworker" />
// The service worker, built to /sw.js by the `serviceWorker` plugin in vite.config.ts. Scope `/`, served
// with `no-cache` (public/_headers), so a deploy reaches installed apps on their next open.

import {
  cacheName,
  handleAsset,
  handleShell,
  precacheUrls,
  readPush,
  staleCaches,
  strategyFor,
} from './sw-core';

declare const self: ServiceWorkerGlobalScope;

// Replaced at build time with the JSON list of built files; its hash is the cache version.
const BUILD = JSON.parse('__FIETS_PRECACHE__') as { version: string; files: string[] };
const CACHE = cacheName(BUILD.version);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(precacheUrls(BUILD.files)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleCaches(names, CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === 'network') return;
  const handler = strategy === 'shell' ? handleShell : handleAsset;
  event.respondWith(caches.open(CACHE).then((cache) => handler(event.request, cache, fetch)));
});

self.addEventListener('push', (event) => {
  let data: unknown;
  try {
    data = event.data?.json();
  } catch {
    // Not JSON: readPush falls back to a generic notification.
  }
  const msg = readPush(data, 'Fiets Vandaag');
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: '/icons/icon-192.png',
      data: { url: msg.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? '/#/today';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      return open ? open.navigate(url).then((w) => w?.focus()) : self.clients.openWindow(url);
    }),
  );
});
