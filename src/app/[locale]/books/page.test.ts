import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { compileFunction } from "node:vm";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import type { CategoryListItem } from "../../../db/queries/books";
import * as filters from "../../../lib/catalog-filters";
import { createLocalizedMetadata } from "../../../lib/seo-metadata-core";

type Locale = "en" | "es";

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

const names: Record<string, Partial<Record<Locale, string>>> = {
  adventure: { en: "Adventure", es: "Aventura" },
  // Only translated into English: its Spanish page shows the English name and has no Spanish language version.
  "gothic-fiction": { en: "Gothic Fiction" },
};

function categoriesFor(locale: Locale): CategoryListItem[] {
  return Object.entries(names).map(([slug, translations]) => ({
    id: slug,
    slug,
    name: translations[locale] ?? translations.en ?? slug,
    bookCount: 1,
    locales: (["en", "es"] as const).filter((item) => item in translations),
  }));
}

function translate(locale: Locale, namespace: "catalog" | "errors") {
  const messages: Record<string, string> = (locale === "en" ? en : es)[namespace];
  return (key: string, values: Record<string, string> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

const stub = (name: string) => Object.assign(() => null, { displayName: name });

// Books matching each request in the stand-in catalog: 33 in all (2 pages of 30), 7 in a category (1 page).
function totalFor({ category }: { category?: string }) {
  return category ? 7 : 33;
}

// Loads page.tsx with its dependencies replaced, so it runs without a database or Next.js runtime.
function loadPage(requestLocale: Locale = "es", queries: string[] = []) {
  const dependencies: Record<string, unknown> = {
    react,
    "react/jsx-runtime": jsxRuntime,
    "next-intl/server": {
      getLocale: async () => requestLocale,
      getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: "catalog" | "errors" }) =>
        translate(locale, namespace),
    },
    "next/navigation": {
      notFound: () => {
        throw new Error("notFound()");
      },
    },
    "react-icons/fi": { FiSearch: stub("FiSearch") },
    "@/components/books/BookCard": { BookCard: stub("BookCard") },
    "@/components/books/CatalogPagination": { CatalogPagination: stub("CatalogPagination") },
    "@/components/ui/button": { Button: stub("Button") },
    "@/components/ui/input": { Input: stub("Input") },
    "@/db/queries/books": {
      getBookPage: async (locale: Locale, filters: { query?: string; category?: string; page?: number }) => {
        queries.push(`getBookPage:${locale}:${JSON.stringify(filters)}`);
        const total = totalFor(filters);
        return {
          books: [],
          total,
          page: filters.page ?? 1,
          pageSize: 30,
          totalPages: Math.max(1, Math.ceil(total / 30)),
        };
      },
      getCategories: async (locale: Locale) => (queries.push(`getCategories:${locale}`), categoriesFor(locale)),
    },
    "@/i18n/navigation": { Link: stub("Link") },
    "@/lib/catalog-filters": filters,
    "@/lib/seo-metadata": { createLocalizedMetadata },
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

function metadataFor(
  locale: Locale,
  searchParams: { q?: string | string[]; category?: string | string[]; page?: string | string[] },
) {
  process.env.SITE_URL = "https://libra.example";
  return loadPage(locale).generateMetadata({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(searchParams),
  });
}

test("a category is its own page: canonical and hreflang keep the filter in both locales", async () => {
  for (const [locale, name] of [
    ["es", "Aventura"],
    ["en", "Adventure"],
  ] as const) {
    const metadata = await metadataFor(locale, { category: "adventure" });

    assert.equal(metadata.robots, undefined);
    assert.equal(String(metadata.alternates?.canonical), `https://libra.example/${locale}/books?category=adventure`);
    assert.deepEqual(metadata.alternates?.languages, {
      en: "https://libra.example/en/books?category=adventure",
      es: "https://libra.example/es/books?category=adventure",
    });
    assert.equal(metadata.title, translate(locale, "catalog")("categoryMetadataTitle", { category: name }));
    assert.ok(String(metadata.description).includes(name));
  }
});

test("a category without a name in one locale announces no invented language version", async () => {
  for (const locale of ["es", "en"] as const) {
    const metadata = await metadataFor(locale, { category: "gothic-fiction" });

    assert.equal(
      String(metadata.alternates?.canonical),
      `https://libra.example/${locale}/books?category=gothic-fiction`,
    );
    assert.equal(metadata.alternates?.languages, undefined);
  }
});

test("the catalog without a category keeps its canonical and language versions", async () => {
  for (const searchParams of [{}, { category: "" }, { category: ["adventure", "fantasy"] }]) {
    const metadata = await metadataFor("es", searchParams);

    assert.equal(metadata.robots, undefined);
    assert.equal(String(metadata.alternates?.canonical), "https://libra.example/es/books");
    assert.deepEqual(metadata.alternates?.languages, {
      en: "https://libra.example/en/books",
      es: "https://libra.example/es/books",
    });
    assert.equal(metadata.title, es.catalog.booksMetadataTitle);
  }
});

test("a search stays noindex, follow without canonical or hreflang, also within a category", async () => {
  for (const searchParams of [{ q: "dracula" }, { q: "dracula", category: "adventure" }]) {
    const metadata = await metadataFor("en", searchParams);

    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates, undefined);
  }
});

test("a category that does not exist gets noindex 404 metadata and the page raises notFound()", async () => {
  for (const category of ["x", "Adventure", "adventure-x"]) {
    const metadata = await metadataFor("es", { category });

    assert.equal(metadata.title, es.errors.notFoundTitle);
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates, undefined);

    const queries: string[] = [];
    const { default: BooksPage } = loadPage("es", queries);

    // Raised before the Suspense boundary: a real 404 for Googlebot, a 200 for browsers (docs/seo.md).
    await assert.rejects(BooksPage({ searchParams: Promise.resolve({ category }) }), /notFound\(\)/);
    assert.deepEqual(queries, ["getCategories:es"]);
  }
});

test("a known category, a search or no filter renders the catalog instead of a 404", async () => {
  for (const searchParams of [{}, { category: "adventure" }, { q: "x" }, { category: "  adventure " }]) {
    const { default: BooksPage } = loadPage("en");
    const element = await BooksPage({ searchParams: Promise.resolve(searchParams) });

    assert.equal(element.type, react.Suspense);
  }
});

test("each later page is its own canonical URL, with the same page as its language versions and a page title", async () => {
  for (const [locale, title, suffix] of [
    ["es", es.catalog.booksMetadataTitle, "Página 2"],
    ["en", en.catalog.booksMetadataTitle, "Page 2"],
  ] as const) {
    const metadata = await metadataFor(locale, { page: "2" });

    assert.equal(metadata.robots, undefined);
    assert.equal(String(metadata.alternates?.canonical), `https://libra.example/${locale}/books?page=2`);
    assert.deepEqual(metadata.alternates?.languages, {
      en: "https://libra.example/en/books?page=2",
      es: "https://libra.example/es/books?page=2",
    });
    assert.equal(metadata.title, `${title} — ${suffix}`);
  }
});

test("page 1 keeps the clean canonical and title, with or without ?page=1", async () => {
  for (const searchParams of [{}, { page: "1" }]) {
    const metadata = await metadataFor("es", searchParams);

    assert.equal(String(metadata.alternates?.canonical), "https://libra.example/es/books");
    assert.equal(metadata.title, es.catalog.booksMetadataTitle);
  }

  const category = await metadataFor("en", { category: "adventure", page: "1" });
  assert.equal(String(category.alternates?.canonical), "https://libra.example/en/books?category=adventure");
});

test("a search stays noindex, follow without canonical or hreflang on any page", async () => {
  const metadata = await metadataFor("en", { q: "the", page: "2" });

  assert.deepEqual(metadata.robots, { index: false, follow: true });
  assert.equal(metadata.alternates, undefined);
  assert.equal(metadata.title, `${en.catalog.booksMetadataTitle} — Page 2`);
});

test("a page that is not a plain number, or is past the last, is a 404", async () => {
  // 33 books make 2 pages; the category has 7 books, so 1 page.
  for (const searchParams of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "abc" },
    { page: "01" },
    { page: ["2", "3"] },
    { page: "10000" },
    { page: "3" },
    { category: "adventure", page: "2" },
  ]) {
    const metadata = await metadataFor("es", searchParams);

    assert.equal(metadata.title, es.errors.notFoundTitle, JSON.stringify(searchParams));
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates, undefined);

    const { default: BooksPage } = loadPage("es");
    await assert.rejects(BooksPage({ searchParams: Promise.resolve(searchParams) }), /notFound\(\)/);
  }
});

test("only a later page is counted before streaming, with the arguments the page renders with", async () => {
  const firstPage: string[] = [];
  await loadPage("es", firstPage).default({ searchParams: Promise.resolve({}) });
  assert.deepEqual(firstPage, []);

  const secondPage: string[] = [];
  const element = await loadPage("es", secondPage).default({
    searchParams: Promise.resolve({ q: " ", category: "adventure", page: "1" }),
  });
  assert.equal(element.type, react.Suspense);
  assert.deepEqual(secondPage, ["getCategories:es"]);

  const lastPage: string[] = [];
  await loadPage("en", lastPage).default({ searchParams: Promise.resolve({ page: "2" }) });
  assert.deepEqual(lastPage, ['getBookPage:en:{"query":"","category":"","page":2}']);
});
