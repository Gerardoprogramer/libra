import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseEdition } from "./edition-selection";
import { bookLink, bookLinkLocale, bookPath } from "./book-links";

const edition = (language: string, slug = `edition-${language}`) => ({
  language,
  slug,
  isPreferred: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

// What a page passes as editionLanguage: the edition chooseEdition selects for the interface locale.
function linkFor(editions: ReturnType<typeof edition>[], interfaceLocale: "en" | "es", chapterSlug?: string) {
  const selected = chooseEdition(editions, interfaceLocale);
  assert.ok(selected);
  return bookLink({ slug: "a-book", editionLanguage: selected.language, chapterSlug }, interfaceLocale);
}

test("a book with only an English edition is linked under /en from both interfaces", () => {
  for (const locale of ["en", "es"] as const) {
    assert.deepEqual(linkFor([edition("en")], locale), { href: "/books/a-book", locale: "en" });
    assert.deepEqual(linkFor([edition("en")], locale, "chapter-1"), { href: "/books/a-book/chapter-1", locale: "en" });
  }
});

test("a book with only a Spanish edition is linked under /es from both interfaces", () => {
  for (const locale of ["en", "es"] as const) {
    assert.deepEqual(linkFor([edition("es")], locale), { href: "/books/a-book", locale: "es" });
    assert.deepEqual(linkFor([edition("es-MX")], locale, "capitulo-1"), {
      href: "/books/a-book/capitulo-1",
      locale: "es",
    });
  }
});

test("a book with editions in both languages keeps the interface locale", () => {
  const editions = [edition("en"), edition("es")];

  assert.deepEqual(linkFor(editions, "en"), { href: "/books/a-book", locale: "en" });
  assert.deepEqual(linkFor(editions, "es"), { href: "/books/a-book", locale: "es" });
  assert.deepEqual(linkFor(editions, "es", "capitulo-2"), { href: "/books/a-book/capitulo-2", locale: "es" });
});

test("a language that is not a locale of the site keeps the interface locale", () => {
  assert.equal(bookLinkLocale("fr", "es"), "es");
  assert.equal(bookLinkLocale("", "en"), "en");
  assert.equal(bookLinkLocale("EN-GB", "es"), "en");
});

test("a pinned edition stays in ?edition= and does not change the locale", () => {
  const editionId = "7b1f1d2c-3d4e-4f50-8a6b-7c8d9e0f1a2b";

  assert.deepEqual(bookLink({ slug: "a-book", editionLanguage: "es", chapterSlug: "capitulo-1", editionId }, "es"), {
    href: `/books/a-book/capitulo-1?edition=${editionId}`,
    locale: "es",
  });
  assert.deepEqual(bookLink({ slug: "a-book", editionLanguage: "en", editionId }, "es"), {
    href: `/books/a-book?edition=${editionId}`,
    locale: "en",
  });
});

test("book paths encode their segments", () => {
  assert.equal(bookPath("ñandú"), "/books/%C3%B1and%C3%BA");
  assert.equal(bookPath("a-book", "a b"), "/books/a-book/a%20b");
});
