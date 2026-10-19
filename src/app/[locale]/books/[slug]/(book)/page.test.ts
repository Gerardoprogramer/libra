import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { compileFunction } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../../../../../messages/en.json";
import es from "../../../../../../messages/es.json";
import { isSlug } from "../../../../../lib/catalog-filters";
import { createLocalizedMetadata } from "../../../../../lib/seo-metadata-core";

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
function loadPage(book: BookFixture, queries: string[] = []) {
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
      getBookBySlug: async (slug: string) => (queries.push(`getBookBySlug:${slug}`), book),
      getBookContentLocales: async (slug: string) => (
        queries.push(`getBookContentLocales:${slug}`),
        book ? ["en"] : []
      ),
      getSitemapContent: async () => ({ books: [], chapters: [] }),
    },
    "@/components/books/LibraryButton": {},
    "@/lib/catalog-filters": { isSlug },
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

// Values a URL can carry that no stored slug can match: separators, spaces, punctuation, empty, over 300 characters.
const invalidSlugs = [
  "../etc/passwd",
  "dracula%00",
  "a b",
  "dracula;--",
  "-dracula",
  "dracula--x",
  "",
  "a".repeat(301),
];

test("F-02: an invalid book slug gets the noindex 404 metadata without querying the database", async () => {
  process.env.SITE_URL = "https://libra.example";

  for (const slug of invalidSlugs) {
    const queries: string[] = [];
    const { generateMetadata } = loadPage(null, queries);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: "en", slug }) });

    assert.equal(metadata.title, en.book.notFoundTitle);
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates, undefined);
    assert.deepEqual(queries, [], slug);
  }
});

test("F-02: an invalid book slug raises notFound() without querying the database", async () => {
  for (const slug of invalidSlugs) {
    const queries: string[] = [];
    const { default: BookPage } = loadPage(null, queries);

    await assert.rejects(BookPage({ params: Promise.resolve({ locale: "en", slug }) }), /notFound\(\)/);
    assert.deepEqual(queries, [], slug);
  }
});

test("F-02: valid slugs, including accented ones, still reach the queries", async () => {
  for (const slug of ["dracula", "the-picture-of-dorian-gray", "cien-años"]) {
    const queries: string[] = [];
    const { generateMetadata } = loadPage(null, queries);
    await generateMetadata({ params: Promise.resolve({ locale: "es", slug }) });

    assert.deepEqual(queries, [`getBookBySlug:${slug}`, `getBookContentLocales:${slug}`]);
  }
});
