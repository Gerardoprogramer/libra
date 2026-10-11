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
  "next/cache": { cacheLife() {}, cacheTag() {} },
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
