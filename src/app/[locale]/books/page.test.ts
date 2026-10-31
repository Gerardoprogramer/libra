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
    "@/components/ui/button": { Button: stub("Button") },
    "@/components/ui/input": { Input: stub("Input") },
    "@/db/queries/books": {
      getBooks: async () => (queries.push("getBooks"), []),
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

function metadataFor(locale: Locale, searchParams: { q?: string | string[]; category?: string | string[] }) {
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

    // Raised before the Suspense boundary, so the response is a real 404 and not a streamed 200.
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
