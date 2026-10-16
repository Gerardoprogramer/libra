import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../../../../messages/en.json";
import { isSlug } from "../../../../lib/catalog-filters";
import { createLocalizedMetadata } from "../../../../lib/seo-metadata-core";

// Loads page.tsx with its dependencies replaced, so it runs without a database or Next.js runtime.
function loadPage(queries: string[]) {
  const messages: Record<string, string> = en.author;
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next-intl/server": { getTranslations: async () => (key: string) => messages[key] },
    "next/navigation": {
      notFound: () => {
        throw new Error("notFound()");
      },
    },
    "@/components/books/BookCard": {},
    "@/db/queries/books": {
      getAuthorBySlug: async (slug: string) => (queries.push(`getAuthorBySlug:${slug}`), null),
    },
    "@/lib/catalog-filters": { isSlug },
    "@/lib/seo-metadata": { createLocalizedMetadata },
    "@/components/seo/JsonLd": {},
    "@/lib/site-url": { getConfiguredSiteUrl: () => null },
  };
  const exports = {} as typeof import("./page");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports;
}

const invalidSlugs = ["../etc/passwd", "bram stoker", "bram-stoker;--", "-bram", "bram--stoker", "", "a".repeat(301)];

test("F-02: an invalid author slug gets the noindex 404 metadata without querying the database", async () => {
  for (const slug of invalidSlugs) {
    const queries: string[] = [];
    const metadata = await loadPage(queries).generateMetadata({ params: Promise.resolve({ locale: "en", slug }) });

    assert.equal(metadata.title, en.author.notFoundTitle);
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.deepEqual(queries, [], slug);
  }
});

test("F-02: an invalid author slug raises notFound() without querying the database", async () => {
  for (const slug of invalidSlugs) {
    const queries: string[] = [];
    const { default: AuthorPage } = loadPage(queries);

    await assert.rejects(AuthorPage({ params: Promise.resolve({ locale: "en", slug }) }), /notFound\(\)/);
    assert.deepEqual(queries, [], slug);
  }
});

test("F-02: valid author slugs still reach the query", async () => {
  for (const slug of ["bram-stoker", "mary-shelley", "benito-pérez-galdós"]) {
    const queries: string[] = [];
    const { default: AuthorPage } = loadPage(queries);

    await assert.rejects(AuthorPage({ params: Promise.resolve({ locale: "es", slug }) }), /notFound\(\)/);
    assert.deepEqual(queries, [`getAuthorBySlug:${slug}`]);
  }
});
