import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CATEGORY_LENGTH,
  MAX_SEARCH_LENGTH,
  containsPattern,
  escapeLikePattern,
  isSlug,
  isUuid,
  normalizeCategorySlug,
  normalizeSearchQuery,
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
