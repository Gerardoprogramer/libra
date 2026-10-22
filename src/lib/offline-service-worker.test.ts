import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const ORIGIN = "https://www.alyvenor.com";
const OFFLINE_PAGES = ["/offline-es.html", "/offline-en.html"];

const workerSource = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const offlinePage = (locale: "es" | "en") =>
  readFileSync(new URL(`../../public/offline-${locale}.html`, import.meta.url), "utf8");

// The worker that turns the fallback off, exactly as docs/offline-fallback.md publishes it.
const killSwitchSource = (() => {
  const docs = readFileSync(new URL("../../docs/offline-fallback.md", import.meta.url), "utf8");
  const match = docs.match(/```js\r?\n([\s\S]*?)```/);
  assert.ok(match, "docs/offline-fallback.md has the kill switch");
  return match[1].replace(/^ {3}/gm, "");
})();

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

type Network = (request: Request | FakeRequest) => Promise<Response>;

/** A Cache Storage that keeps entries by URL; put() is never expected, so it fails and is counted. */
function fakeCaches(initial: Record<string, Record<string, string>> = {}) {
  const store = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(initial)) {
    store.set(
      name,
      new Map(Object.entries(entries).map(([url, body]) => [new URL(url, ORIGIN).href, new Response(body)])),
    );
  }
  const log = { puts: 0, addAll: [] as Request[][] };
  let network: Network = async () => {
    throw new TypeError("no network");
  };

  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name)!;
    return {
      // Atomic as in the browsers: every response must be OK before any is stored.
      async addAll(requests: Request[]) {
        log.addAll.push(requests);
        const responses = await Promise.all(requests.map((request) => network(request)));
        if (responses.some((response) => !response.ok)) throw new TypeError("addAll: a response was not OK");
        requests.forEach((request, index) => entries.set(request.url, responses[index]));
      },
      async put() {
        log.puts += 1;
        throw new Error("the worker must never store a response");
      },
      async match(url: string) {
        return entries.get(new URL(url, ORIGIN).href);
      },
      async keys() {
        return [...entries.keys()].map((url) => new Request(url));
      },
    };
  };

  return {
    store,
    log,
    setNetwork(next: Network) {
      network = next;
    },
    api: {
      open,
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
      match: async (url: string, options: { cacheName?: string } = {}) => {
        const names = options.cacheName ? [options.cacheName] : [...store.keys()];
        for (const name of names) {
          const response = store.get(name)?.get(new URL(url, ORIGIN).href);
          if (response) return response;
        }
        return undefined;
      },
    },
  };
}

/** Runs a worker script in its own context with fake browser APIs, and lets tests dispatch its events. */
function loadWorker(source: string, caches = fakeCaches(), { failDeleting }: { failDeleting?: string } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const calls = { skipWaiting: 0, claim: 0, unregister: 0, network: [] as (Request | FakeRequest)[] };
  const order: string[] = [];
  let network: Network = async () => {
    throw new TypeError("Failed to fetch");
  };
  const fetch = (request: Request | FakeRequest) => {
    calls.network.push(request);
    return network(request);
  };
  caches.setNetwork((request) => fetch(request));

  const self = {
    location: new URL("/sw.js", ORIGIN),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: async () => {
      calls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        calls.claim += 1;
        order.push("claim");
      },
    },
    registration: {
      unregister: async () => {
        calls.unregister += 1;
        order.push("unregister");
        return true;
      },
    },
  };
  const cacheApi = {
    ...caches.api,
    delete: async (name: string) => {
      order.push(`delete ${name}`);
      if (name === failDeleting) throw new Error(`could not delete ${name}`);
      return caches.api.delete(name);
    },
  };
  // Relative URLs resolve against the worker's location, as in a ServiceWorkerGlobalScope.
  class WorkerRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, ORIGIN), init);
    }
  }

  runInContext(source, createContext({ self, caches: cacheApi, fetch, Request: WorkerRequest, URL, Promise }));

  return {
    listeners,
    calls,
    order,
    caches,
    setNetwork(next: Network) {
      network = next;
    },
    async install() {
      let done: Promise<unknown> = Promise.resolve();
      listeners.get("install")!({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
      return done;
    },
    async activate() {
      let done: Promise<unknown> = Promise.resolve();
      listeners.get("activate")!({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
      return done;
    },
    /** The worker's answer, or null when it leaves the request to the browser. */
    dispatchFetch(request: FakeRequest): Promise<Response> | null {
      let answer: Promise<Response> | null = null;
      listeners.get("fetch")?.({
        request,
        respondWith: (response: Promise<Response>) => {
          answer = response;
        },
      });
      return answer;
    },
  };
}

const navigation = (path: string, init: Partial<FakeRequest> = {}): FakeRequest => ({
  url: new URL(path, ORIGIN).href,
  method: "GET",
  mode: "navigate",
  ...init,
});

const offlinePages = () => Object.fromEntries(OFFLINE_PAGES.map((page) => [page, `<html>${page}</html>`]));

async function installedWorker() {
  const worker = loadWorker(workerSource);
  worker.setNetwork(async (request) => new Response(`<html>${new URL(request.url).pathname}</html>`));
  await worker.install();
  await worker.activate();
  worker.calls.network.length = 0;
  return worker;
}

const currentCacheName = (worker: ReturnType<typeof loadWorker>) => {
  const names = [...worker.caches.store.keys()];
  assert.equal(names.length, 1);
  return names[0];
};

test("install stores exactly the two offline pages, past the HTTP cache, in a versioned Libra cache", async () => {
  const worker = loadWorker(workerSource);
  worker.setNetwork(async () => new Response("<html></html>"));

  await worker.install();

  const name = currentCacheName(worker);
  assert.match(name, /^libra-offline-.+/);
  assert.deepEqual(
    [...worker.caches.store.get(name)!.keys()].sort(),
    OFFLINE_PAGES.map((page) => new URL(page, ORIGIN).href).sort(),
  );
  assert.equal(worker.caches.log.addAll.length, 1);
  assert.ok(worker.caches.log.addAll[0].every((request) => request.cache === "reload"));
  assert.equal(worker.calls.skipWaiting, 1);
});

const failedDownloads = [
  async (request: Request | FakeRequest) =>
    request.url.endsWith("/offline-en.html") ? new Response("", { status: 404 }) : new Response("<html></html>"),
  async (request: Request | FakeRequest) => {
    if (request.url.endsWith("/offline-en.html")) throw new TypeError("Failed to fetch");
    return new Response("<html></html>");
  },
];

test("a failed download fails the install and leaves no cache behind, so the active worker stays in charge", async () => {
  for (const failure of failedDownloads) {
    const worker = loadWorker(workerSource);
    worker.setNetwork(failure);

    await assert.rejects(worker.install(), /addAll|Failed to fetch/);
    assert.deepEqual([...worker.caches.store.keys()], []);
    assert.equal(worker.calls.skipWaiting, 0);
  }
});

test("a failed download over a cache that already holds the pages fails the install and keeps that cache", async () => {
  const cacheName = `libra-offline-${workerSource.match(/const CACHE_VERSION = "(.+?)";/)![1]}`;

  for (const failure of failedDownloads) {
    const caches = fakeCaches({ [cacheName]: offlinePages() });
    const worker = loadWorker(workerSource, caches);
    worker.setNetwork(failure);

    await assert.rejects(worker.install(), /addAll|Failed to fetch/);
    assert.deepEqual([...caches.store.keys()], [cacheName]);
    assert.equal(
      await (await caches.api.match("/offline-en.html", { cacheName }))!.text(),
      "<html>/offline-en.html</html>",
    );
    assert.equal(worker.calls.skipWaiting, 0);
  }
});

test("activation takes control of open pages, then removes only Libra's earlier offline caches", async () => {
  const caches = fakeCaches({ "libra-offline-v0": offlinePages(), "other-app": { "/x": "x" }, "libra-other": {} });
  const worker = loadWorker(workerSource, caches);
  worker.setNetwork(async () => new Response("<html></html>"));

  await worker.install();
  const current = [...caches.store.keys()].find(
    (name) => !["libra-offline-v0", "other-app", "libra-other"].includes(name),
  );
  await worker.activate();

  assert.deepEqual([...caches.store.keys()].sort(), ["libra-other", current, "other-app"].sort());
  assert.deepEqual(worker.order, ["claim", "delete libra-offline-v0"]);
});

// The rejected promise is only what activate's waitUntil receives: browsers still activate the worker, and report the
// error in its console. That part is the browser's lifecycle and is not modeled here.
test("a cleanup that fails rejects the activate promise after the open pages were claimed, and the fallback still works", async () => {
  const caches = fakeCaches({ "libra-offline-v0": offlinePages() });
  const worker = loadWorker(workerSource, caches, { failDeleting: "libra-offline-v0" });
  worker.setNetwork(async (request) => new Response(`<html>${new URL(request.url).pathname}</html>`));

  await worker.install();
  const current = [...caches.store.keys()].find((name) => name !== "libra-offline-v0")!;
  await assert.rejects(worker.activate(), /could not delete libra-offline-v0/);

  assert.equal(worker.calls.claim, 1);
  assert.deepEqual(worker.order, ["claim", "delete libra-offline-v0"]);
  // The current cache is untouched; the old one stays until the next activation removes it.
  assert.deepEqual([...caches.store.keys()].sort(), ["libra-offline-v0", current].sort());
  assert.equal(caches.store.get(current)!.size, 2);
  worker.setNetwork(async () => {
    throw new TypeError("Failed to fetch");
  });
  const response = await worker.dispatchFetch(navigation("/en/books"))!;
  assert.equal(await response.text(), "<html>/offline-en.html</html>");
});

test("only GET document navigations of this origin under /, /es and /en are intercepted", async () => {
  const worker = await installedWorker();

  for (const path of ["/", "/es", "/es/", "/es/books/quijote/1", "/en", "/en/books?q=x", "/en/library"]) {
    assert.ok(worker.dispatchFetch(navigation(path)), path);
  }
  worker.calls.network.length = 0;

  for (const request of [
    navigation("/es/login", { method: "POST" }),
    navigation("/api/reading-progress"),
    navigation("/auth/callback?code=x"),
    navigation("/_next/static/chunks/app.js"),
    navigation("/offline-es.html"),
    navigation("/sw.js"),
    navigation("/estante"),
    navigation("/english"),
    { url: "https://project.supabase.co/auth/v1/token", method: "GET", mode: "navigate" },
    { url: `${ORIGIN}/es/books/quijote/1?_rsc=1`, method: "GET", mode: "cors" },
    { url: `${ORIGIN}/api/reading-progress`, method: "POST", mode: "cors" },
    { url: `${ORIGIN}/_next/static/chunks/app.js`, method: "GET", mode: "no-cors" },
    { url: `${ORIGIN}/es`, method: "GET", mode: "same-origin" },
  ]) {
    assert.equal(worker.dispatchFetch(request), null, `${request.method} ${request.mode} ${request.url}`);
  }
  assert.equal(worker.calls.network.length, 0);
});

test("online, the network's response reaches the page untouched, 404 and 500 included, and nothing is stored", async () => {
  const worker = await installedWorker();
  const name = currentCacheName(worker);

  for (const status of [200, 404, 500]) {
    const response = new Response(`status ${status}`, { status });
    worker.setNetwork(async () => response);

    assert.equal(await worker.dispatchFetch(navigation("/es/books/quijote")), response, String(status));
  }
  assert.equal(worker.caches.log.puts, 0);
  assert.equal(worker.caches.store.get(name)!.size, 2);
});

test("offline, a navigation gets the offline page of its locale, read from the cache only", async () => {
  const worker = await installedWorker();
  worker.setNetwork(async () => {
    throw new TypeError("Failed to fetch");
  });

  for (const [path, page] of [
    ["/", "/offline-es.html"],
    ["/es", "/offline-es.html"],
    ["/es/books/quijote/3", "/offline-es.html"],
    ["/en", "/offline-en.html"],
    ["/en/books/moby-dick/1", "/offline-en.html"],
  ]) {
    worker.calls.network.length = 0;
    const response = await worker.dispatchFetch(navigation(path))!;

    assert.equal(await response.clone().text(), `<html>${page}</html>`, path);
    // The requested page was fetched once; the fallback never went to the network or through the worker.
    assert.deepEqual(
      worker.calls.network.map((request) => request.url),
      [new URL(path, ORIGIN).href],
      path,
    );
  }
  assert.equal(worker.caches.log.puts, 0);
});

test("without the offline page in the cache, the original network error reaches the browser", async () => {
  const worker = await installedWorker();
  for (const entries of worker.caches.store.values()) entries.clear();
  const error = new TypeError("Failed to fetch");
  worker.setNetwork(async () => {
    throw error;
  });

  await assert.rejects(worker.dispatchFetch(navigation("/en/books"))!, (thrown) => thrown === error);
  assert.equal(worker.calls.network.length, 1);
});

test("the worker never stores a response: its only cache write is the install's addAll", () => {
  const code = workerSource.replace(/^\s*(\/\/|\/?\*).*$/gm, "");

  assert.doesNotMatch(code, /\.put\(|\.add\(/);
  assert.equal(code.match(/\.addAll\(/g)?.length, 1);
});

test("the documented kill switch removes only Libra's offline caches, unregisters, and intercepts nothing", async () => {
  const caches = fakeCaches({ "libra-offline-v1": offlinePages(), "libra-offline-v0": {}, "other-app": {} });
  const worker = loadWorker(killSwitchSource, caches);

  await worker.install();
  await worker.activate();

  assert.equal(worker.calls.skipWaiting, 1);
  assert.deepEqual([...caches.store.keys()], ["other-app"]);
  assert.equal(worker.calls.unregister, 1);
  assert.equal(worker.order.at(-1), "unregister");
  assert.equal(worker.listeners.has("fetch"), false);
  assert.equal(worker.dispatchFetch(navigation("/es")), null);
});

for (const [locale, retry] of [
  ["es", "Reintentar"],
  ["en", "Try again"],
] as const) {
  test(`the ${locale} offline page stands alone: no script, no network resource, not indexed`, () => {
    const html = offlinePage(locale);

    assert.match(html, /^<!doctype html>/i);
    assert.match(html, new RegExp(`<html lang="${locale}">`));
    assert.match(html, /<meta name="robots" content="noindex" \/>/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/);
    assert.doesNotMatch(html, /<script|<link|<img|<iframe|src=|srcset=|url\(|@import|_next|https?:/i);
    // An empty href reloads this same URL, without a script or a redirect.
    assert.deepEqual(html.match(/href="[^"]*"/g), ['href=""']);
    assert.match(html, new RegExp(`<a href="">${retry}</a>`));
  });

  test(`the ${locale} offline page does not promise that books can be read offline`, () => {
    const text = offlinePage(locale).replace(/<style>[\s\S]*<\/style>|<!--[\s\S]*?-->|<[^>]+>/g, " ");

    assert.doesNotMatch(text, /disponible|available|guardad|saved|descargad|download/i);
  });
}
