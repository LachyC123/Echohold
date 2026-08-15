/// <reference lib="webworker" />

/**
 * Offline shell for ECHOHOLD.
 *
 * The game requires no network at runtime, so the goal is simply that a second
 * visit works with the radio off. Strategy: precache the shell on install,
 * then serve navigations from cache-first with a network revalidation, and
 * hashed build assets cache-first (their names change when they change).
 *
 * Old caches are deleted on activate, so a new build never serves a mixture of
 * two bundles - the failure mode that produces impossible-looking bugs.
 */

const CACHE_VERSION = 'echohold-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

/**
 * Precache the shell plus every hashed bundle named in the build manifest.
 *
 * Lazy caching alone is not enough: the worker only starts controlling the
 * page after that page has already fetched its scripts, so the first offline
 * visit would find nothing cached. Reading the manifest on install makes a
 * single online visit sufficient.
 */
async function precache() {
  const cache = await caches.open(CACHE_VERSION);
  let assets = SHELL;
  try {
    const response = await fetch('./sw-manifest.json', { cache: 'no-cache' });
    if (response.ok) {
      const manifest = await response.json();
      if (Array.isArray(manifest.assets)) assets = manifest.assets;
    }
  } catch {
    // No manifest (development, or a partial deploy): the shell still works,
    // and everything else falls back to lazy caching.
  }
  // Individually, so one missing file cannot fail the whole install.
  await Promise.all(
    assets.map((asset) => cache.add(asset).catch(() => undefined)),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
    }),
  );
});
