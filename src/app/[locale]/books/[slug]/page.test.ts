import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { compileFunction } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";
import { createLocalizedMetadata } from "../../../../lib/seo-metadata-core";

type Locale = "en" | "es";
type BookFixture = {
  slug: string;
  edition: { title: string; language: string; description: string | null };
  authors: { name: string; slug: string }[];
} | null;

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

function translate(locale: Locale) {
  const messages: Record<string, string> = locale === "en" ? en.book : es.book;
  return (key: string, values: Record<string, string> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

// Loads page.tsx with its dependencies replaced, so generateMetadata runs without a database or Next.js runtime.
function loadPage(book: BookFixture) {
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next/image": {},
    "next-intl/server": { getTranslations: async ({ locale }: { locale: Locale }) => translate(locale) },
    "next/navigation": {
      notFound: () => {
        throw new Error("generateMetadata must not raise notFound()");
      },
    },
    "react-icons/fi": {},
    "@/components/ui/badge": {},
    "@/components/books/BookReadingAction": {},
    "@/components/books/EditionDetails": {},
    "@/db/queries/books": {
      getBookBySlug: async () => book,
      getBookContentLocales: async () => (book ? ["en"] : []),
      getSitemapContent: async () => ({ books: [], chapters: [] }),
    },
    "@/components/books/LibraryButton": {},
    "@/lib/seo-metadata": { createLocalizedMetadata },
    "@/components/seo/JsonLd": {},
    "@/lib/site-url": { getAbsolutePublicImageUrl: () => null, getConfiguredSiteUrl: () => null },
    "@/lib/social-metadata": { getBookSocialImage: () => [] },
    "@/i18n/navigation": {},
    "@/components/books/BookShareButton": {},
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

test("a missing or unpublished book gets a localized noindex 404 title instead of book metadata", async () => {
  process.env.SITE_URL = "https://libra.example";

  for (const [locale, title] of [
    ["en", en.book.notFoundTitle],
    ["es", es.book.notFoundTitle],
  ] as const) {
    const { generateMetadata } = loadPage(null);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale, slug: "libra-test-missing-0f7b16" }) });

    assert.equal(metadata.title, title);
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    // A noindex 404 advertises neither a canonical nor hreflang alternates, and never the book's authors.
    assert.equal(metadata.alternates, undefined);
    assert.equal(metadata.authors, undefined);
  }
});

test("a published book keeps its indexable title, description and authors", async () => {
  const { generateMetadata } = loadPage({
    slug: "dracula",
    edition: { title: "Dracula", language: "en", description: "A real description." },
    authors: [{ name: "Bram Stoker", slug: "bram-stoker" }],
  });
  const metadata = await generateMetadata({ params: Promise.resolve({ locale: "en", slug: "dracula" }) });

  assert.equal(metadata.title, "Dracula — Bram Stoker");
  assert.equal(metadata.description, "A real description.");
  assert.equal(metadata.robots, undefined);
  assert.deepEqual(metadata.authors, [{ name: "Bram Stoker" }]);
});
