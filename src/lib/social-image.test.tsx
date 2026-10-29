import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import * as jsx from "react/jsx-runtime";
import * as og from "next/og";
import ts from "typescript";

import { SocialCard } from "../components/seo/SocialCard";
import * as urls from "./site-url";
import * as metadata from "./social-metadata";

// Exercise the real ImageResponse renderer while isolating Next's cache runtime
// and the remote cover. These tests never connect to PostgreSQL or R2.
// The cache lifetimes the module asks for, in order (the runtime that would honour them is replaced).
const cacheLives: string[] = [];
const loadImageModule = compileFunction(
  ts.transpileModule(readFileSync(new URL("./social-image.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText,
  ["require", "exports"],
);
const dependencies: Record<string, unknown> = {
  "server-only": {},
  "node:fs/promises": fs,
  "node:path": path,
  "react/jsx-runtime": jsx,
  "next/og": og,
  "next/cache": {
    cacheLife(profile: string) {
      cacheLives.push(profile);
    },
    cacheTag() {},
  },
  "@/components/seo/SocialCard": { SocialCard },
  "@/lib/site-url": urls,
  "@/lib/social-metadata": metadata,
};
const moduleExports = {} as typeof import("./social-image");
loadImageModule((id: string) => {
  assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`);
  return dependencies[id];
}, moduleExports);

const details = {
  locale: "es" as const,
  title: "Una historia para compartir",
  authors: "Una autora",
  slug: "historia",
};
async function png(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  return bytes;
}

test("social cards render different books, including long accented titles without a cover", async () => {
  const first = await png(await moduleExports.createSocialImage(details));
  const second = await png(
    await moduleExports.createSocialImage({
      ...details,
      title:
        "La memoria y los días: una colección de relatos, prólogos y reflexiones sobre la imaginación y la literatura a través de los siglos",
    }),
  );
  assert.notDeepEqual(first, second);
});

test("real cover bytes change the card; unavailable and corrupt images fall back safely", async (context) => {
  const original = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = "https://covers.example/books";
  context.after(() => {
    if (original === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = original;
  });
  const baseline = await png(await moduleExports.createSocialImage(details));
  const withCover = { ...details, coverUrl: "https://covers.example/books/cover.png" };
  const image = readFileSync("public/icons/libra-192.png");
  const fetchMock = context.mock.method(
    globalThis,
    "fetch",
    async () => new Response(image, { headers: { "Content-Type": "image/png" } }),
  );
  const rendered = await png(await moduleExports.createSocialImage(withCover));
  assert.notDeepEqual(rendered, baseline);

  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  assert.deepEqual(await png(await moduleExports.createSocialImage(withCover)), baseline);
  fetchMock.mock.mockImplementation(async () => {
    throw new Error("network unavailable");
  });
  assert.deepEqual(await png(await moduleExports.createSocialImage(withCover)), baseline);
  fetchMock.mock.mockImplementation(
    async () => new Response("corrupt PNG", { headers: { "Content-Type": "image/png" } }),
  );
  assert.deepEqual(await png(await moduleExports.createSocialImage(withCover)), baseline);
  const calls = fetchMock.mock.callCount();
  await png(await moduleExports.createSocialImage({ ...details, coverUrl: "https://untrusted.example/cover.png" }));
  assert.equal(fetchMock.mock.callCount(), calls, "Only the configured R2 media base may be fetched");
});

// During a move to a custom domain both bases serve the same objects: covers under either one are read, any other
// origin still is not. Without R2_PUBLIC_URL_PREVIOUS only the current base is allowed, as before.
test("during a domain move, covers under the previous base are still read", async (context) => {
  const saved = { current: process.env.R2_PUBLIC_URL, previous: process.env.R2_PUBLIC_URL_PREVIOUS };
  process.env.R2_PUBLIC_URL = "https://covers.example.com";
  process.env.R2_PUBLIC_URL_PREVIOUS = "https://pub-0123.r2.dev";
  context.after(() => {
    for (const [name, value] of [
      ["R2_PUBLIC_URL", saved.current],
      ["R2_PUBLIC_URL_PREVIOUS", saved.previous],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const image = readFileSync("public/icons/libra-192.png");
  const fetchMock = context.mock.method(
    globalThis,
    "fetch",
    async () => new Response(image, { headers: { "Content-Type": "image/png" } }),
  );

  for (const coverUrl of [
    "https://covers.example.com/covers/historia-1-abc123.png",
    "https://pub-0123.r2.dev/covers/historia-1-abc123.png",
  ]) {
    const before = fetchMock.mock.callCount();
    await png(await moduleExports.createSocialImage({ ...details, coverUrl }));
    assert.equal(fetchMock.mock.callCount(), before + 1, coverUrl);
  }

  const before = fetchMock.mock.callCount();
  await png(
    await moduleExports.createSocialImage({ ...details, coverUrl: "https://pub-0123.r2.dev.evil.example/x.png" }),
  );
  delete process.env.R2_PUBLIC_URL_PREVIOUS;
  await png(await moduleExports.createSocialImage({ ...details, coverUrl: "https://pub-0123.r2.dev/covers/x.png" }));
  assert.equal(fetchMock.mock.callCount(), before, "other origins, and the previous base once removed, are not read");
});

// Each cover read is an R2 operation. A content-addressed cover is cached for the longest lifetime, and a failed read
// throws out of the cached function, so the fallback card is never what gets cached.
test("a cover read is cached for the longest lifetime, and a failed read is not", async (context) => {
  const original = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = "https://covers.example/books";
  context.after(() => {
    if (original === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = original;
  });
  const withCover = { ...details, coverUrl: "https://covers.example/books/covers/historia-1-abc123.png" };
  const image = readFileSync("public/icons/libra-192.png");

  cacheLives.length = 0;
  const fetchMock = context.mock.method(
    globalThis,
    "fetch",
    async () => new Response(image, { headers: { "Content-Type": "image/png" } }),
  );
  await png(await moduleExports.createSocialImage(withCover));
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(
    cacheLives,
    ["max"],
    "the cover is cached with the longest built-in lifetime, not the editorial one",
  );

  // The cached function rejects on failure (a "use cache" result is only stored when it resolves); the card falls back.
  for (const failure of [
    async () => new Response(null, { status: 503 }),
    async () => new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    async () => {
      throw new Error("network unavailable");
    },
  ]) {
    fetchMock.mock.mockImplementation(failure);
    cacheLives.length = 0;
    const card = await png(await moduleExports.createSocialImage(withCover));
    assert.ok(card.length > 0);
    assert.deepEqual(cacheLives, ["max"]);
  }

  // Covers outside the configured R2 base are never fetched, so they never reach the cached function at all.
  cacheLives.length = 0;
  const calls = fetchMock.mock.callCount();
  await png(await moduleExports.createSocialImage({ ...details, coverUrl: "https://untrusted.example/cover.png" }));
  assert.equal(fetchMock.mock.callCount(), calls);
  assert.deepEqual(cacheLives, []);
});
