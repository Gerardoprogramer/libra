import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CATEGORY_LENGTH,
  MAX_SEARCH_LENGTH,
  containsPattern,
  CATALOG_PAGE_SIZE,
  escapeLikePattern,
  getCatalogPath,
  getCatalogCategoryPath,
  isSlug,
  isUuid,
  normalizeCategorySlug,
  normalizeSearchQuery,
  parseCatalogPage,
} from "./catalog-filters";

test("L11: LIKE wildcards and the escape character match literally", () => {
  assert.equal(escapeLikePattern("50%"), String.raw`50\%`);
  assert.equal(escapeLikePattern("a_b"), String.raw`a\_b`);
  assert.equal(escapeLikePattern(String.raw`a\b`), String.raw`a\\b`);
  assert.equal(containsPattern("100%"), String.raw`%100\%%`);
  assert.equal(containsPattern("plain"), "%plain%");
});

test("search text is reduced to one bounded line without control characters", () => {
  assert.equal(normalizeSearchQuery("  Drácula \n\t  Stoker \u0000 "), "Drácula Stoker");
  assert.equal(normalizeSearchQuery(undefined), "");
  assert.equal(normalizeSearchQuery(["a", "b"]), "");
  assert.equal(normalizeSearchQuery("x".repeat(10_000)).length, MAX_SEARCH_LENGTH);
  assert.equal(normalizeSearchQuery(`${"x".repeat(MAX_SEARCH_LENGTH - 1)} y`), "x".repeat(MAX_SEARCH_LENGTH - 1));
});

test("category slugs are bounded and non-strings are ignored", () => {
  assert.equal(normalizeCategorySlug(" horror "), "horror");
  assert.equal(normalizeCategorySlug(["horror"]), "");
  assert.equal(normalizeCategorySlug("c".repeat(1000)).length, MAX_CATEGORY_LENGTH);
});

test("only well-formed UUIDs are accepted as edition ids", () => {
  assert.equal(isUuid("0b3c2a1e-1111-4222-8333-444455556666"), true);
  for (const value of [
    "",
    "not-a-uuid",
    "0b3c2a1e-1111-4222-8333-44445555666",
    undefined,
    ["0b3c2a1e-1111-4222-8333-444455556666"],
    7,
  ]) {
    assert.equal(isUuid(value), false);
  }
});

test("only stored-looking slugs can name a book or chapter", () => {
  for (const value of ["dracula", "capitulo-i-el-viejo-lobo-marino", "capítulo-primero", "chapter-12"]) {
    assert.equal(isSlug(value), true, value);
  }
  for (const value of [
    "",
    "-lead",
    "trail-",
    "two--hyphens",
    "has space",
    "a/b",
    "../etc",
    "x".repeat(301),
    undefined,
    ["a"],
  ]) {
    assert.equal(isSlug(value), false, String(value));
  }
});

test("a category's catalog path keeps the filter as its only, encoded parameter", () => {
  assert.equal(getCatalogCategoryPath("adventure"), "/books?category=adventure");
  assert.equal(getCatalogCategoryPath("ficción-gótica"), "/books?category=ficci%C3%B3n-g%C3%B3tica");
});

test("a catalog page is one plain number from 1 to 9999, and absent is page 1", () => {
  assert.equal(CATALOG_PAGE_SIZE, 30);
  assert.equal(parseCatalogPage(undefined), 1);

  for (const [value, page] of [
    ["1", 1],
    ["2", 2],
    ["42", 42],
    ["9999", 9999],
  ] as const) {
    assert.equal(parseCatalogPage(value), page, value);
  }

  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "abc",
    "01",
    "002",
    "10000",
    "1e3",
    " 2",
    "2 ",
    "+2",
    "0x2",
    ["2"],
    ["2", "3"],
    2,
    null,
  ]) {
    assert.equal(parseCatalogPage(value), null, JSON.stringify(value));
  }
});

test("catalog paths keep category and search in a fixed order and never write page 1", () => {
  assert.equal(getCatalogPath({}), "/books");
  assert.equal(getCatalogPath({ page: 1 }), "/books");
  assert.equal(getCatalogPath({ page: 2 }), "/books?page=2");
  assert.equal(getCatalogPath({ category: "adventure", page: 1 }), "/books?category=adventure");
  assert.equal(getCatalogPath({ category: "adventure", page: 3 }), "/books?category=adventure&page=3");
  assert.equal(
    getCatalogPath({ page: 2, query: "las aventuras", category: "adventure" }),
    "/books?category=adventure&q=las+aventuras&page=2",
  );
  assert.equal(getCatalogPath({ query: "50% & más", page: 2 }), "/books?q=50%25+%26+m%C3%A1s&page=2");
  assert.equal(getCatalogPath({ category: "", query: "", page: 2 }), "/books?page=2");
});
