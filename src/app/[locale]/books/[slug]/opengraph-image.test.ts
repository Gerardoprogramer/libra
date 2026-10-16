import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

import { isSlug } from "../../../../lib/catalog-filters";

const dracula = {
  slug: "dracula",
  edition: { title: "Dracula", coverUrl: null },
  authors: [{ name: "Bram Stoker" }],
};

// Loads opengraph-image.tsx with its dependencies replaced, recording every query and every rendered image.
function loadImage(book: typeof dracula | null) {
  const calls: string[] = [];
  const dependencies: Record<string, unknown> = {
    "next-intl": { hasLocale: (locales: readonly string[], locale: string) => locales.includes(locale) },
    "@/db/queries/books": {
      getBookBySlug: async (slug: string) => (calls.push(`getBookBySlug:${slug}`), book),
    },
    "@/i18n/routing": { routing: { locales: ["es", "en"] } },
    "@/lib/catalog-filters": { isSlug },
    "@/lib/social-image": {
      createSocialImage: (input: { slug: string }) => (
        calls.push(`createSocialImage:${input.slug}`),
        new Response("png")
      ),
    },
  };
  const exports = {} as typeof import("./opengraph-image");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./opengraph-image.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return { BookImage: exports.default, calls };
}

test("F-02: an invalid slug gets an uncached 404 with no query and no rendered image", async () => {
  for (const slug of ["../etc/passwd", "dracula;--", "a b", "-dracula", "", "a".repeat(301)]) {
    const { BookImage, calls } = loadImage(dracula);
    const response = await BookImage({ params: Promise.resolve({ locale: "en", slug }) });

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(calls, [], slug);
  }
});

test("F-02: a valid but unknown slug is queried once and not rendered", async () => {
  const { BookImage, calls } = loadImage(null);
  const response = await BookImage({ params: Promise.resolve({ locale: "en", slug: "missing-book" }) });

  assert.equal(response.status, 404);
  assert.deepEqual(calls, ["getBookBySlug:missing-book"]);
});

test("F-02: a published book still renders its card", async () => {
  const { BookImage, calls } = loadImage(dracula);
  const response = await BookImage({ params: Promise.resolve({ locale: "es", slug: "dracula" }) });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["getBookBySlug:dracula", "createSocialImage:dracula"]);
});
