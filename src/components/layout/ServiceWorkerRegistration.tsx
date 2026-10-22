"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, the offline fallback (docs/offline-fallback.md), in production builds only, Vercel previews
 * included, and only where the browser supports service workers. "none" fetches the worker past the HTTP cache on
 * every update check. A failed registration leaves the site as it is without a worker, so it is ignored.
 */
export function registerServiceWorker(environment: string | undefined, browser: Navigator | undefined) {
  if (environment !== "production" || !browser || !("serviceWorker" in browser)) return null;

  return browser.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
}

/** Renders nothing; registers the worker once, after hydration. Nothing runs on the server. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    void registerServiceWorker(process.env.NODE_ENV, navigator);
  }, []);

  return null;
}
