// Libra's offline fallback (docs/offline-fallback.md). When a page navigation fails because the network is down, the
// page is answered with a static notice in its locale instead of the browser's own error page. Nothing else.
//
// Cache limits: the only cache is CACHE_NAME, and it only ever holds the two OFFLINE_PAGES, stored at install. No
// response of the application is stored: there is no cache.put(), and online navigations are answered by the network
// alone, exactly as they would be without this worker.
//
// Change CACHE_VERSION with every change to this file or to the offline pages: the new worker then installs its own
// cache, and only once it is active removes the caches of the earlier versions.

const CACHE_PREFIX = "libra-offline-";
const CACHE_VERSION = "v2";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Spanish is the default locale (src/i18n/routing.ts), so "/" falls back to it.
const OFFLINE_PAGES = { es: "/offline-es.html", en: "/offline-en.html" };

/**
 * The offline page for a request, or null if this worker must leave the request alone. Only a GET navigation of a
 * document of this origin under "/", "/es" or "/en" qualifies: API calls, Auth and its OAuth callback (/auth), Next.js
 * assets and data requests (/_next, RSC fetches), reading progress, covers, form posts and every other origin never
 * reach respondWith, so the browser handles them as if there were no worker.
 */
function offlinePageFor(request) {
  if (request.mode !== "navigate" || request.method !== "GET") return null;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;

  const { pathname } = url;
  if (pathname === "/" || pathname === "/es" || pathname.startsWith("/es/")) return OFFLINE_PAGES.es;
  if (pathname === "/en" || pathname.startsWith("/en/")) return OFFLINE_PAGES.en;

  return null;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // addAll stores both pages or neither, and rejects on any response that is not OK, so a failed download fails
        // the install and the worker already active stays in charge. "reload" skips the HTTP cache.
        await cache.addAll(Object.values(OFFLINE_PAGES).map((page) => new Request(page, { cache: "reload" })));
      } catch (error) {
        // A failed install leaves no empty cache behind. A cache that already holds the pages is kept: it is the
        // active worker's if CACHE_VERSION was not changed.
        if ((await cache.keys()).length === 0) await caches.delete(CACHE_NAME);
        throw error;
      }
      // The worker never changes an online response, so a new version can take over open pages at once.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Pages opened before the worker was installed get the fallback from their next navigation. First, so a failed
      // cleanup cannot leave them uncontrolled.
      await self.clients.claim();
      // Only Libra's own earlier offline caches: any other cache of this origin is left as it is. A failed deletion
      // still fails this step, so the error is reported; the worker is active and its own cache complete either way.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
    })(),
  );
});

// Navigation preload is not enabled: a preloaded response that fails would need its own error path, and the worker is
// small enough to start quickly.
self.addEventListener("fetch", (event) => {
  const page = offlinePageFor(event.request);
  if (!page) return;

  event.respondWith(
    // Any response the network gives, 404 and 500 included, goes to the page untouched. Only a rejected fetch (no
    // connection, DNS failure) falls back, and the URL in the address bar stays the requested one.
    fetch(event.request).catch(async (error) => {
      const fallback = await caches.match(page, { cacheName: CACHE_NAME });
      // Read from the cache only, never fetched again, so the fallback cannot loop. Without it, the browser shows
      // its own network error.
      if (!fallback) throw error;

      return fallback;
    }),
  );
});
