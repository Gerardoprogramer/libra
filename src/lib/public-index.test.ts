import assert from "node:assert/strict";
import { test } from "node:test";

import { createPublicSitemap, createRobotsMetadata } from "./public-index";

test("sitemap includes localized public indexes and unique book and author routes", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    books: [
      { slug: "dracula", locales: ["en"] },
      { slug: "frankenstein", locales: ["en"] },
      { slug: "marianela", locales: ["es"] },
      { slug: "dracula", locales: ["en"] },
    ],
    chapters: [],
    authorSlugs: ["mary-shelley"],
  });

  const urls = sitemap.map(({ url }) => url);

  assert.equal(urls.length, 13);

  for (const locale of ["en", "es"]) {
    for (const path of ["/", "/books", "/authors", "/categories", "/authors/mary-shelley"]) {
      const expectedUrl = `https://libra.example/${locale}${path === "/" ? "" : path}`;

      assert.ok(urls.includes(expectedUrl));
    }
  }

  assert.ok(urls.includes("https://libra.example/en/books/dracula"));
  assert.ok(urls.includes("https://libra.example/en/books/frankenstein"));
  assert.ok(urls.includes("https://libra.example/es/books/marianela"));

  assert.ok(!urls.includes("https://libra.example/es/books/dracula"));
  assert.ok(!urls.includes("https://libra.example/es/books/frankenstein"));
  assert.ok(!urls.includes("https://libra.example/en/books/marianela"));

  assert.equal(new Set(urls).size, urls.length);
});

test("sitemap includes chapters only in their actual content locale", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    books: [
      { slug: "dracula", locales: ["en"] },
      { slug: "marianela", locales: ["es"] },
    ],
    chapters: [
      {
        bookSlug: "dracula",
        slug: "chapter-1",
        locale: "en",
      },
      {
        bookSlug: "dracula",
        slug: "chapter-2",
        locale: "en",
      },
      {
        bookSlug: "marianela",
        slug: "capitulo-1",
        locale: "es",
      },
    ],
    authorSlugs: [],
  });

  const urls = sitemap.map(({ url }) => url);

  assert.ok(urls.includes("https://libra.example/en/books/dracula/chapter-1"));
  assert.ok(urls.includes("https://libra.example/en/books/dracula/chapter-2"));
  assert.ok(urls.includes("https://libra.example/es/books/marianela/capitulo-1"));

  assert.ok(!urls.includes("https://libra.example/es/books/dracula/chapter-1"));
  assert.ok(!urls.includes("https://libra.example/en/books/marianela/capitulo-1"));

  const englishChapter = sitemap.find(({ url }) => url === "https://libra.example/en/books/dracula/chapter-1");

  const spanishChapter = sitemap.find(({ url }) => url === "https://libra.example/es/books/marianela/capitulo-1");

  assert.ok(englishChapter);
  assert.ok(spanishChapter);

  assert.equal(englishChapter?.alternates?.languages, undefined);
  assert.equal(spanishChapter?.alternates?.languages, undefined);

  assert.equal(new Set(urls).size, urls.length);
});

test("sitemap emits reciprocal language alternates only when a book has multiple content locales", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    books: [
      {
        slug: "dracula",
        locales: ["en", "es"],
      },
    ],
    chapters: [],
    authorSlugs: [],
  });

  const entry = sitemap.find(({ url }) => url === "https://libra.example/en/books/dracula");

  assert.deepEqual(entry?.alternates?.languages, {
    en: "https://libra.example/en/books/dracula",
    es: "https://libra.example/es/books/dracula",
  });

  const spanishEntry = sitemap.find(({ url }) => url === "https://libra.example/es/books/dracula");

  assert.deepEqual(spanishEntry?.alternates?.languages, {
    en: "https://libra.example/en/books/dracula",
    es: "https://libra.example/es/books/dracula",
  });
});

test("sitemap does not create language alternates for a book with only one content locale", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    books: [
      {
        slug: "marianela",
        locales: ["es"],
      },
    ],
    chapters: [],
    authorSlugs: [],
  });

  const entry = sitemap.find(({ url }) => url === "https://libra.example/es/books/marianela");

  assert.ok(entry);
  assert.equal(entry?.alternates?.languages, undefined);

  assert.ok(!sitemap.some(({ url }) => url === "https://libra.example/en/books/marianela"));
});

test("sitemap is empty when SITE_URL is not configured", () => {
  assert.deepEqual(
    createPublicSitemap(null, {
      books: [{ slug: "dracula", locales: ["en"] }],
      chapters: [],
      authorSlugs: ["mary-shelley"],
    }),
    [],
  );
});

test("sitemap excludes user libraries, readers, endpoints, and non-public routes", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    books: [{ slug: "dracula", locales: ["en"] }],
    chapters: [
      {
        bookSlug: "dracula",
        slug: "chapter-1",
        locale: "en",
      },
    ],
    authorSlugs: ["mary-shelley"],
  });

  const urls = sitemap.map(({ url }) => url);

  assert.ok(urls.every((url) => url.startsWith("https://")));
  assert.ok(urls.every((url) => !url.includes("/library")));
  assert.ok(urls.every((url) => !url.includes("/api/")));
  assert.ok(urls.every((url) => !url.includes("?")));
  assert.ok(urls.every((url) => !url.includes("/read/")));
});

test("robots allows public pages and disallows API endpoints", () => {
  const robots = createRobotsMetadata(new URL("https://libra.example"));
  const rules = robots.rules as { allow?: string; disallow?: string[] };

  assert.equal(rules.allow, "/");
  assert.deepEqual(rules.disallow, ["/api/"]);
  assert.equal(robots.sitemap, "https://libra.example/sitemap.xml");
});

test("robots remains useful in development without SITE_URL and does not block render assets", () => {
  const robots = createRobotsMetadata(null);
  const rules = robots.rules as { allow?: string; disallow?: string[] };

  assert.equal(rules.allow, "/");
  assert.equal(robots.sitemap, undefined);
  assert.ok(!rules.disallow?.some((path) => path.includes("_next")));
});

test("sitemap lists each category as the filtered catalog in the locales it is translated into", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    books: [],
    chapters: [],
    authorSlugs: [],
    categories: [
      { slug: "adventure", locales: ["en", "es"] },
      { slug: "gothic-fiction", locales: ["en"] },
    ],
  });

  const urls = sitemap.map(({ url }) => url);
  const adventure = sitemap.find(({ url }) => url === "https://libra.example/es/books?category=adventure");
  const gothic = sitemap.find(({ url }) => url === "https://libra.example/en/books?category=gothic-fiction");

  assert.ok(urls.includes("https://libra.example/en/books?category=adventure"));
  assert.deepEqual(adventure?.alternates?.languages, {
    en: "https://libra.example/en/books?category=adventure",
    es: "https://libra.example/es/books?category=adventure",
  });

  // No Spanish version is invented for a category without a Spanish name.
  assert.ok(gothic);
  assert.equal(gothic.alternates, undefined);
  assert.ok(!urls.includes("https://libra.example/es/books?category=gothic-fiction"));

  // Only the categories given (those with public books) appear, and never a search.
  assert.equal(urls.filter((url) => url.includes("category=")).length, 3);
  assert.ok(urls.every((url) => !url.includes("q=")));
  assert.equal(new Set(urls).size, urls.length);
});
