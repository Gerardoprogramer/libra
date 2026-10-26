import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { compileFunction } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../../../../../messages/en.json";
import es from "../../../../../../messages/es.json";
import type { BookDetails } from "../../../../../db/queries/books";
import { isSlug } from "../../../../../lib/catalog-filters";
import { createLocalizedMetadata } from "../../../../../lib/seo-metadata-core";
import * as workDescriptions from "../../../../../lib/work-descriptions";

type Locale = "en" | "es";
type BookFixture = {
  slug: string;
  edition: { title: string; language: string; description: string | null };
  authors: { name: string; slug: string }[];
} | null;

interface PageOptions {
  queries?: string[];
  // The locale of the request, which BookPage's getTranslations(namespace) reads.
  locale?: Locale;
  siteUrl?: string | null;
  // Replaces the published work descriptions, recording each lookup; without it the real content/works is read.
  works?: Partial<Record<Locale, string>>;
  lookups?: string[];
}

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

function translate(locale: Locale, namespace: "book" | "reader" = "book") {
  const messages: Record<string, string> = (locale === "en" ? en : es)[namespace];
  return (key: string, values: Record<string, string> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

// Stand-ins for the components the page renders: the element tree keeps their props, which the tests read.
const stub = (name: string) => Object.assign(() => null, { displayName: name });
const JsonLd = stub("JsonLd");
const WorkDescription = stub("WorkDescription");

// Loads page.tsx with its dependencies replaced, so generateMetadata runs without a database or Next.js runtime.
function loadPage(book: BookFixture, queriesOrOptions: string[] | PageOptions = []) {
  const options = Array.isArray(queriesOrOptions) ? { queries: queriesOrOptions } : queriesOrOptions;
  const { queries = [], locale: requestLocale = "en", siteUrl = null, works, lookups = [] } = options;
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next/image": { default: stub("Image") },
    "next-intl/server": {
      getTranslations: async (scope: string | { locale: Locale; namespace: "book" }) =>
        typeof scope === "string" ? translate(requestLocale, scope as "book" | "reader") : translate(scope.locale),
    },
    "next/navigation": {
      notFound: () => {
        throw new Error("generateMetadata must not raise notFound()");
      },
    },
    "react-icons/fi": { FiBookOpen: stub("FiBookOpen") },
    "@/components/ui/badge": { Badge: stub("Badge") },
    "@/components/books/BookReadingAction": { BookReadingAction: stub("BookReadingAction") },
    "@/components/books/EditionDetails": { EditionDetails: stub("EditionDetails") },
    "@/components/books/WorkDescription": { WorkDescription },
    "@/lib/work-descriptions": works
      ? {
          ...workDescriptions,
          getWorkDescription: (slug: string, locale: Locale) => (
            lookups.push(`${slug}:${locale}`),
            works[locale] ?? null
          ),
        }
      : workDescriptions,
    "@/db/queries/books": {
      getBookBySlug: async (slug: string) => (queries.push(`getBookBySlug:${slug}`), book),
      getBookContentLocales: async (slug: string) => (
        queries.push(`getBookContentLocales:${slug}`),
        book ? ["en"] : []
      ),
      getSitemapContent: async () => ({ books: [], chapters: [] }),
    },
    "@/components/books/LibraryButton": { LibraryButton: stub("LibraryButton") },
    "@/lib/catalog-filters": { isSlug },
    "@/lib/seo-metadata": { createLocalizedMetadata },
    "@/components/seo/JsonLd": { JsonLd },
    "@/lib/site-url": { getAbsolutePublicImageUrl: () => null, getConfiguredSiteUrl: () => siteUrl },
    "@/lib/social-metadata": { getBookSocialImage: () => [] },
    "@/i18n/navigation": { Link: stub("Link") },
    "@/components/books/BookShareButton": { BookShareButton: stub("BookShareButton") },
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

// "About this work" (src/lib/work-descriptions.ts).

const workText = {
  es: "Una novela de aventuras publicada como libro en 1883, narrada por un muchacho que se embarca en busca de un tesoro.",
  en: "An adventure novel published as a book in 1883, told by a boy who sets sail in search of a buried treasure.",
};

// A book as getBookBySlug returns it, with what BookPage renders.
function book(edition: { language: string; title?: string; description?: string | null }) {
  return {
    id: "book-1",
    slug: "treasure-island",
    originalTitle: "Treasure Island",
    originalLanguage: "en",
    originalPublicationYear: 1883,
    authors: [{ id: "author-1", name: "Robert Louis Stevenson", slug: "robert-louis-stevenson" }],
    categories: [],
    chapters: [],
    edition: {
      id: `edition-${edition.language}`,
      slug: edition.language,
      title: edition.title ?? "Treasure Island",
      description: null,
      translator: null,
      publicationYear: null,
      coverUrl: null,
      sourceName: null,
      sourceIdentifier: null,
      sourceUrl: null,
      copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",
      ...edition,
    },
  } satisfies BookDetails;
}

interface Element {
  type: unknown;
  props: { children?: unknown; [name: string]: unknown };
}

// The rendered tree: the elements of the given component, and every text the page itself writes out.
function inspect(tree: unknown) {
  const elements: Element[] = [];
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === "string") texts.push(node);
    else if (node && typeof node === "object" && "props" in node) {
      elements.push(node as Element);
      walk((node as Element).props.children);
    }
  };
  walk(tree);
  const of = (component: unknown) => elements.filter((element) => element.type === component);
  const [about] = of(WorkDescription);
  const graph = (of(JsonLd)[0]?.props.data as { "@graph": Record<string, unknown>[] } | undefined)?.["@graph"] ?? [];

  return {
    about: about?.props as { description: string | null; lang: string } | undefined,
    structured: graph.find((entry) => entry["@type"] === "Book"),
    // What a reader sees: the page's own text and the description WorkDescription renders.
    visible: [...texts, ...(typeof about?.props.description === "string" ? [about.props.description] : [])],
  };
}

async function renderPage(fixture: BookFixture, locale: Locale, options: PageOptions = {}) {
  const { default: BookPage } = loadPage(fixture, { siteUrl: "https://libra.example", locale, ...options });
  return inspect(await BookPage({ params: Promise.resolve({ locale, slug: "treasure-island" }) }));
}

test("metadata takes the edition's description, then the work's published one, then the template", async () => {
  const long = `${workText.en} ${"It sails on, chapter after chapter, through storms and calms. ".repeat(4)}`;

  for (const [edition, works, expected] of [
    [{ language: "en", description: "  The edition's own words.  " }, { en: long }, "The edition's own words."],
    [{ language: "en", description: "   " }, { en: workText.en }, workText.en],
    [{ language: "en" }, { en: long }, workDescriptions.summarizeDescription(long)],
    [
      { language: "en" },
      {},
      "Read Treasure Island by Robert Louis Stevenson online for free on Libra. Explore this digital edition and its chapters.",
    ],
  ] as const) {
    const { generateMetadata } = loadPage(book(edition), { works });
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: "en", slug: "treasure-island" }) });

    assert.equal(metadata.description, expected);
  }
  assert.ok(workDescriptions.summarizeDescription(long).length <= 160);
});

test("a pilot description still in draft leaves the template, and no section, in both languages", async () => {
  for (const locale of ["es", "en"] as const) {
    // The real content/works, where the four pilot works are drafts.
    const { generateMetadata } = loadPage(book({ language: locale }));
    const metadata = await generateMetadata({ params: Promise.resolve({ locale, slug: "treasure-island" }) });
    assert.equal(
      metadata.description,
      translate(locale)("metadataDescription", { title: "Treasure Island", authors: "Robert Louis Stevenson" }),
    );

    const page = await renderPage(book({ language: locale }), locale);
    assert.equal(page.about?.description, null);
    assert.equal(page.structured?.description, undefined);
  }
});

test("the work's description is shown in the interface language, whichever edition of the work is served", async () => {
  for (const locale of ["es", "en"] as const) {
    for (const language of ["en", "es"]) {
      const lookups: string[] = [];
      const page = await renderPage(book({ language }), locale, { works: workText, lookups });

      assert.deepEqual(page.about, { description: workText[locale], lang: locale }, `${locale} ${language}`);
      assert.ok(
        lookups.length > 0 && lookups.every((lookup) => lookup === `treasure-island:${locale}`),
        String(lookups),
      );
    }
  }
});

test("structured data describes the book only with text shown on the page", async () => {
  // The edition's description is shown in the header; it stays the one structured data repeats.
  let page = await renderPage(book({ language: "en", description: "The edition's own words." }), "en", {
    works: workText,
  });
  assert.equal(page.structured?.description, "The edition's own words.");
  assert.ok(page.visible.includes(String(page.structured?.description)));
  assert.equal(page.about?.description, workText.en);

  // Without it, the work's description, whole, as the section shows it.
  page = await renderPage(book({ language: "en" }), "en", { works: workText });
  assert.equal(page.structured?.description, workText.en);
  assert.ok(page.visible.includes(workText.en));
  // Never the shortened text metadata uses, which the page does not show.
  const long = `${workText.en} ${"It sails on, chapter after chapter, through storms and calms. ".repeat(4)}`.trim();
  page = await renderPage(book({ language: "en" }), "en", { works: { en: long } });
  assert.equal(page.structured?.description, long);
  assert.ok(page.visible.includes(long));

  // Without either, no description at all.
  page = await renderPage(book({ language: "en" }), "en", { works: {} });
  assert.equal(page.structured?.description, undefined);
  assert.equal(page.about?.description, null);
});

test("structured data takes the work's description only in the language of the edition it describes", async () => {
  // The Spanish interface serves the English edition: the section shows the Spanish text, but the Book is English.
  let page = await renderPage(book({ language: "en" }), "es", { works: workText });
  assert.equal(page.structured?.inLanguage, "en");
  assert.equal(page.structured?.description, undefined);
  assert.deepEqual(page.about, { description: workText.es, lang: "es" });

  // The edition's own description is still the Book's, whatever the interface language.
  page = await renderPage(book({ language: "en", description: "The edition's own words." }), "es", { works: workText });
  assert.equal(page.structured?.description, "The edition's own words.");

  // Matching languages, including a regional edition language.
  for (const [locale, language] of [
    ["es", "es"],
    ["en", "en"],
    ["es", "es-ES"],
  ] as const) {
    page = await renderPage(book({ language }), locale, { works: workText });
    assert.equal(page.structured?.inLanguage, language);
    assert.equal(page.structured?.description, workText[locale], `${locale} ${language}`);
  }
});
