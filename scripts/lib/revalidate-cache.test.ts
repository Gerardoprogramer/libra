import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { revalidateEditorialCache } from "./revalidate-cache";

const originalUrl = process.env.CACHE_REVALIDATION_URL;
const originalSecret = process.env.CACHE_REVALIDATION_SECRET;
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalLog = console.log;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.CACHE_REVALIDATION_URL;
  else process.env.CACHE_REVALIDATION_URL = originalUrl;

  if (originalSecret === undefined) delete process.env.CACHE_REVALIDATION_SECRET;
  else process.env.CACHE_REVALIDATION_SECRET = originalSecret;

  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  console.log = originalLog;
});

function silenceLogs() {
  const warnings: string[] = [];
  const logs: string[] = [];
  console.warn = (message?: unknown) => warnings.push(String(message));
  console.log = (message?: unknown) => logs.push(String(message));
  return { warnings, logs };
}

function configureEndpoint() {
  process.env.CACHE_REVALIDATION_URL = "https://libra.example/api/revalidate-cache";
  process.env.CACHE_REVALIDATION_SECRET = "test-only-secret";
}

test("cache invalidation refuses invalid tags or missing endpoint configuration without fetching", async () => {
  const { warnings } = silenceLogs();
  delete process.env.CACHE_REVALIDATION_URL;
  delete process.env.CACHE_REVALIDATION_SECRET;
  globalThis.fetch = async () => assert.fail("must not make a network request");

  assert.equal(await revalidateEditorialCache(["invalid tag"]), false);
  assert.equal(await revalidateEditorialCache(["library"]), false);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.includes("WARNING")));
});

test("cache invalidation requires HTTPS for remote origins and rejects URL credentials and query strings", async () => {
  const { warnings } = silenceLogs();
  process.env.CACHE_REVALIDATION_SECRET = "test-only-secret";
  globalThis.fetch = async () => assert.fail("must reject unsafe URLs before fetching");

  for (const endpoint of [
    "http://remote.example/api/revalidate",
    "https://user:password@libra.example/api/revalidate",
    "https://libra.example/api/revalidate?token=secret",
  ]) {
    process.env.CACHE_REVALIDATION_URL = endpoint;
    assert.equal(await revalidateEditorialCache(["library"]), false);
  }

  assert.equal(warnings.length, 3);
});

test("cache invalidation succeeds only after the endpoint confirms every requested tag", async () => {
  const { logs } = silenceLogs();
  configureEndpoint();
  let requestUrl = "";
  let requestHeaders: HeadersInit | undefined;
  let requestBody = "";

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = init?.headers;
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ revalidated: true, tags: ["library:editorial", "book:dracula"] }), {
      status: 200,
    });
  };

  assert.equal(await revalidateEditorialCache(["library", "book:dracula"]), true);
  assert.equal(requestUrl, process.env.CACHE_REVALIDATION_URL);
  assert.equal(new Headers(requestHeaders).get("Authorization"), "Bearer test-only-secret");
  assert.deepEqual(JSON.parse(requestBody), { tags: ["library:editorial", "book:dracula"] });
  assert.equal(logs.length, 1);
});

test("cache invalidation handles bad status, invalid JSON, and mismatched confirmations safely", async () => {
  const { warnings } = silenceLogs();
  configureEndpoint();
  const responses: Response[] = [
    new Response("unavailable", { status: 503 }),
    new Response("{", { status: 200 }),
    new Response(JSON.stringify({ revalidated: false, tags: ["book:dracula"] }), { status: 200 }),
    new Response(JSON.stringify({ revalidated: true, tags: ["book:frankenstein"] }), { status: 200 }),
  ];
  globalThis.fetch = async () => responses.shift()!;

  for (let index = 0; index < 4; index++) {
    assert.equal(await revalidateEditorialCache(["book:dracula"]), false);
  }

  assert.equal(warnings.length, 4);
});

test("cache invalidation never exposes endpoint errors or the configured secret", async () => {
  const { warnings } = silenceLogs();
  configureEndpoint();
  globalThis.fetch = async () => {
    throw new Error("request failed with test-only-secret");
  };

  assert.equal(await revalidateEditorialCache(["library"]), false);
  assert.ok(warnings.every((warning) => !warning.includes("test-only-secret")));
  assert.ok(warnings.every((warning) => !warning.includes("request failed")));
});
