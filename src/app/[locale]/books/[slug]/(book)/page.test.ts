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
const BookSynopsis = stub("BookSynopsis");
const Link = stub("Link");

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
    "@/components/books/BookSynopsis": { BookSynopsis },
    "@/components/books/EditionDetails": { EditionDetails: stub("EditionDetails") },
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
    "@/i18n/navigation": { Link },
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

// Work and edition descriptions (src/lib/work-descriptions.ts): the page's one synopsis and its metadata.

const workText = {
  es: "Una novela de aventuras publicada como libro en 1883, narrada por un muchacho que se embarca en busca de un tesoro.",
  en: "An adventure novel published as a book in 1883, told by a boy who sets sail in search of a buried treasure.",
};

// A book as getBookBySlug returns it, with what BookPage renders.
function book(
  edition: { language: string; title?: string; description?: string | null },
  categories: BookDetails["categories"] = [],
) {
  return {
    id: "book-1",
    slug: "treasure-island",
    originalTitle: "Treasure Island",
    originalLanguage: "en",
    originalPublicationYear: 1883,
    authors: [{ id: "author-1", name: "Robert Louis Stevenson", slug: "robert-louis-stevenson" }],
    categories,
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

// The rendered tree: the Book of the structured data, and every string the page renders or hands to a component
// (the components are stubs, so a description passed to any of them counts as shown). Only JsonLd's data is left out.
function inspect(tree: unknown) {
  const elements: Element[] = [];
  const visible: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") visible.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object" && "props" in value) {
      const element = value as Element;
      elements.push(element);
      for (const [name, prop] of Object.entries(element.props)) {
        if (element.type === JsonLd && name === "data") continue;
        collect(prop);
      }
    }
  };
  collect(tree);
  const graph =
    (
      elements.find((element) => element.type === JsonLd)?.props.data as
        { "@graph": Record<string, unknown>[] } | undefined
    )?.["@graph"] ?? [];

  return {
    structured: graph.find((entry) => entry["@type"] === "Book"),
    // The props of each BookSynopsis the page renders, a synopsis without text included.
    synopses: elements.filter((element) => element.type === BookSynopsis).map((element) => element.props),
    // The links to the catalog filtered by a category: the page's category badges.
    categoryLinks: elements
      .filter((element) => element.type === Link && String(element.props.href).startsWith("/books?category="))
      .map((element) => ({ href: element.props.href, name: element.props.children })),
    visible,
    shows: (text: string) => visible.some((shown) => shown.includes(text)),
    // How many rendered strings carry the text: one for a text shown once.
    count: (text: string) => visible.filter((shown) => shown.includes(text)).length,
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
    // The same description reaches the previews when the page is shared.
    assert.equal(metadata.openGraph?.description, expected);
    assert.equal(metadata.twitter?.description, expected);
  }
  assert.ok(workDescriptions.summarizeDescription(long).length <= 160);
});

test("the work's published description is metadata in each interface language, whichever edition is served", async () => {
  for (const locale of ["es", "en"] as const) {
    for (const language of ["en", "es"]) {
      const lookups: string[] = [];
      const { generateMetadata } = loadPage(book({ language }), { works: workText, lookups });
      const metadata = await generateMetadata({ params: Promise.resolve({ locale, slug: "treasure-island" }) });

      assert.equal(metadata.description, workText[locale], `${locale} ${language}`);
      assert.ok(
        lookups.length > 0 && lookups.every((lookup) => lookup === `treasure-island:${locale}`),
        String(lookups),
      );
    }
  }
});

test("the work's published description is the synopsis in each interface language, whichever edition is served", async () => {
  for (const locale of ["es", "en"] as const) {
    for (const language of ["en", "es"]) {
      const page = await renderPage(book({ language }), locale, { works: workText });

      // One synopsis, in the language of its text, and the other language's text nowhere.
      assert.deepEqual(page.synopses, [{ text: workText[locale], lang: locale }], `${locale} ${language}`);
      assert.equal(page.count(workText[locale]), 1, `${locale} ${language}`);
      assert.equal(page.shows(workText[locale === "es" ? "en" : "es"]), false, `${locale} ${language}`);
      // The page itself still renders: its title is on it.
      assert.ok(page.shows("Treasure Island"), `${locale} ${language}`);
    }
  }
});

test("the edition's own description is the synopsis instead of the work's, in the edition's language", async () => {
  for (const [locale, language, lang] of [
    ["en", "en", "en"],
    ["es", "en", "en"],
    ["es", "es-ES", "es"],
  ] as const) {
    const page = await renderPage(book({ language, description: "  The edition's own words.  " }), locale, {
      works: workText,
    });

    // As the meta description takes it: the edition's first. Never both on the page.
    assert.deepEqual(page.synopses, [{ text: "The edition's own words.", lang }], `${locale} ${language}`);
    assert.equal(page.shows(workText.es), false, `${locale} ${language}`);
    assert.equal(page.shows(workText.en), false, `${locale} ${language}`);
  }
});

test("without a published description the synopsis gets no text, and nothing is invented", async () => {
  for (const locale of ["es", "en"] as const) {
    for (const description of [null, "   "]) {
      const page = await renderPage(book({ language: locale, description }), locale, { works: {} });

      // BookSynopsis renders nothing without text (its own tests), so no empty section or heading reaches the page.
      assert.deepEqual(page.synopses, [{ text: null, lang: locale }], locale);
      assert.equal(page.shows(translate(locale)("synopsis")), false, locale);
    }
  }
});

test("the categories are shown once each, as links to the filtered catalog, in the given order", async () => {
  const categories = [
    { id: "category-1", slug: "aventura", name: "Aventura" },
    { id: "category-2", slug: "novela-juvenil", name: "Novela juvenil" },
  ];
  const page = await renderPage(book({ language: "es" }, categories), "es", { works: workText });

  assert.deepEqual(page.categoryLinks, [
    { href: "/books?category=aventura", name: "Aventura" },
    { href: "/books?category=novela-juvenil", name: "Novela juvenil" },
  ]);
  for (const { name } of categories) assert.equal(page.count(name), 1, name);
  assert.deepEqual(page.structured?.genre, ["Aventura", "Novela juvenil"]);

  // Without categories, no links and no genre.
  const uncategorized = await renderPage(book({ language: "es" }), "es", { works: workText });
  assert.deepEqual(uncategorized.categoryLinks, []);
  assert.equal(uncategorized.structured?.genre, undefined);
});

test("a pilot description still in draft leaves the template and no structured description, in both languages", async () => {
  // The real content/works, where the four pilot works are drafts.
  const drafts = (["es", "en"] as const).map(
    (locale) => workDescriptions.WORK_DESCRIPTIONS.get("treasure-island")![locale],
  );
  assert.ok(drafts.every((draft) => draft.status === "draft"));

  for (const locale of ["es", "en"] as const) {
    const { generateMetadata } = loadPage(book({ language: locale }));
    const metadata = await generateMetadata({ params: Promise.resolve({ locale, slug: "treasure-island" }) });
    const template = translate(locale)("metadataDescription", {
      title: "Treasure Island",
      authors: "Robert Louis Stevenson",
    });
    assert.equal(metadata.description, template);
    assert.equal(metadata.openGraph?.description, template);

    const page = await renderPage(book({ language: locale }), locale);
    assert.equal(page.structured?.description, undefined);
    assert.deepEqual(page.synopses, [{ text: null, lang: locale }]);
    for (const draft of drafts) assert.equal(page.shows(draft.text), false);
  }
});

test("structured data takes the edition's description, else the work's whole: the synopsis the page shows", async () => {
  let page = await renderPage(book({ language: "en", description: "The edition's own words." }), "en", {
    works: workText,
  });
  assert.equal(page.structured?.description, "The edition's own words.");
  assert.equal(page.count("The edition's own words."), 1);

  // Without it, the work's description, whole: never the shortened text of the meta description.
  const long = `${workText.en} ${"It sails on, chapter after chapter, through storms and calms. ".repeat(4)}`.trim();
  page = await renderPage(book({ language: "en" }), "en", { works: { en: long } });
  assert.equal(page.structured?.description, long);
  assert.deepEqual(page.synopses, [{ text: long, lang: "en" }]);
  assert.equal(page.shows(workDescriptions.summarizeDescription(long)), false);

  // Without either, no description at all.
  page = await renderPage(book({ language: "en" }), "en", { works: {} });
  assert.equal(page.structured?.description, undefined);
});

test("structured data takes the work's description only in the language of the edition it describes", async () => {
  // The Spanish interface serves the English edition: the Spanish text does not describe the English Book.
  let page = await renderPage(book({ language: "en" }), "es", { works: workText });
  assert.equal(page.structured?.inLanguage, "en");
  assert.equal(page.structured?.description, undefined);

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

test("a work published in content/works shows its own synopsis in /es and in /en", async () => {
  // The real descriptions, not stand-ins: Lazarillo de Tormes is published in both languages.
  for (const locale of ["es", "en"] as const) {
    const text = workDescriptions.getWorkDescription("lazarillo-de-tormes", locale);
    assert.ok(text, locale);

    const fixture = { ...book({ language: "es", title: "Lazarillo de Tormes" }), slug: "lazarillo-de-tormes" };
    const page = await renderPage(fixture, locale);
    assert.deepEqual(page.synopses, [{ text, lang: locale }], locale);
    assert.equal(page.count(text), 1, locale);

    const { generateMetadata } = loadPage(fixture);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale, slug: "lazarillo-de-tormes" }) });
    // The meta description is the same text, shortened.
    assert.equal(metadata.description, workDescriptions.summarizeDescription(text), locale);
  }
});
