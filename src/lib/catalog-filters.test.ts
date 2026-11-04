import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CATEGORY_LENGTH,
  MAX_SEARCH_LENGTH,
  containsPattern,
  CATALOG_PAGE_SIZE,
  escapeLikePattern,
  foldSearchText,
  getCatalogPath,
  getCatalogCategoryPath,
  isSlug,
  isUuid,
  normalizeCategorySlug,
  normalizeSearchQuery,
  parseCatalogPage,
  SEARCH_IGNORED_MARKS,
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

const nfd = (value: string) => value.normalize("NFD");

test("a search is folded: case and accents never decide a match", () => {
  for (const value of ["galdos", "Galdós", "GALDOS", "GALDÓS", "Galdo\u0301s", "GALDO\u0301S"]) {
    assert.equal(foldSearchText(value), "galdos", value);
  }
  assert.equal(foldSearchText("Pérez Galdós"), "perez galdos");
  assert.equal(foldSearchText("niño"), "nino");
  assert.equal(foldSearchText("NIÑO"), "nino");
  assert.equal(foldSearchText("Pingüino Ça"), "pinguino ca");
  assert.equal(foldSearchText("Nguyễn"), "nguyen");
  assert.equal(foldSearchText("İstanbul"), "istanbul");
  for (const [value, folded] of [
    ["ḁ", "a"],
    ["ế", "e"],
    ["ễ", "e"],
    ["ỳ", "y"],
    ["Ἀθῆναι", "αθηναι"],
    ["Йошкар-Ола", "иошкар-ола"],
  ]) {
    assert.equal(foldSearchText(value), folded, value);
  }
  assert.equal(foldSearchText("plain text"), "plain text");
  // Letters without a canonical decomposition are not other letters, and no letter becomes two.
  assert.equal(foldSearchText("Øresund Łódź Straße Æsir Œuvre"), "øresund łodz straße æsir œuvre");
  // Only U+0300-U+036F is ignored: a mark of another block stays, on both sides.
  assert.equal(foldSearchText("a\u1dc0b"), "a\u1dc0b");
  // Isolated marks fold to nothing; next to letters, only the letters remain.
  assert.equal(foldSearchText("\u0301"), "");
  assert.equal(foldSearchText("\u0301\u0308\u0303"), "");
  assert.equal(foldSearchText("\u0301e\u0301"), "e");
  // Folding never adds a LIKE wildcard or the escape character: those are escaped afterwards, unchanged.
  assert.equal(foldSearchText(String.raw`100%_Ñ\x`), String.raw`100%_n\x`);
  assert.equal(containsPattern(foldSearchText(String.raw`100%_Ñ\x`)), String.raw`%100\%\_n\\x%`);
});

test("the ignored marks are exactly the Combining Diacritical Marks block, each once and in order", () => {
  const marks = Array.from(SEARCH_IGNORED_MARKS);

  assert.equal(marks.length, 0x036f - 0x0300 + 1);
  marks.forEach((mark, index) => assert.equal(mark.codePointAt(0), 0x0300 + index));
  for (const mark of marks) assert.match(mark, /^\p{Mn}$/u);
});

// translate(value, from, '') as PostgreSQL defines it: every character of `from` is deleted, nothing else changes.
// Applied after lower(normalize(value, NFD)), for which JavaScript's normalize("NFD") and toLowerCase() stand in here;
// that those agree with PostgreSQL's is a property of the database, checked against a real server, not in this test.
function sqlFold(value: string) {
  const deleted = new Set(Array.from(SEARCH_IGNORED_MARKS));

  return Array.from(value.normalize("NFD").toLowerCase())
    .filter((character) => !deleted.has(character))
    .join("");
}

const storedSamples = [
  "Benito Pérez Galdós",
  "Galdo\u0301s",
  "El niño",
  "nino",
  "Nguyễn",
  "İstanbul",
  "ḁ ế ễ ỳ",
  "José María de Pereda",
  "ÁRBOL ÉPICO ÍNTIMO ÓPERA ÚLTIMO ÜBER ÑANDÚ",
  "ΟΔΟΣ Ἀθῆναι",
  "Йошкар-Ола",
  "Øresund Łódź Straße",
  "a\u1dc0b",
  "100 real",
  "a_b",
  "plain text",
  "\u0301",
];

test("a stored value and the same value typed as a search always fold alike, in NFC or NFD", () => {
  for (const stored of storedSamples) {
    for (const form of [stored, stored.normalize("NFC"), nfd(stored)]) {
      // The column side (translate of lower of normalize) and the search side give the same text...
      assert.equal(sqlFold(form), foldSearchText(stored), JSON.stringify(form));
      // ...so the value always finds itself, whichever form is stored and whichever is typed.
      assert.ok(sqlFold(form).includes(foldSearchText(form.normalize("NFC"))), JSON.stringify(form));
      assert.ok(sqlFold(form).includes(foldSearchText(nfd(form))), JSON.stringify(form));
    }
    // The folded text is itself NFD, the form the SQL side compares in.
    assert.equal(foldSearchText(stored), nfd(foldSearchText(stored)), JSON.stringify(stored));
  }
});

test("matching works both ways: accented and plain, NFC and NFD, upper and lower case", () => {
  const finds = (search: string, stored: string) => sqlFold(stored).includes(foldSearchText(search));

  for (const [search, stored] of [
    ["niño", "nino"],
    ["nino", "El niño"],
    ["galdos", "Benito Pérez Galdós"],
    ["Galdós", "galdos"],
    ["GALDÓS", "Benito Pérez Galdós"],
    ["perez galdos", "Benito Pérez Galdós"],
    ["Galdós", "Galdo\u0301s"],
    ["Galdo\u0301s", "Galdós"],
    ["nguyen", "Nguyễn"],
    ["Nguyễn", nfd("Nguyễn")],
    ["istanbul", "İstanbul"],
    ["İstanbul", "istanbul"],
    ["pereda", "José María de Pereda"],
  ]) {
    assert.ok(finds(search, stored), `${JSON.stringify(search)} finds ${JSON.stringify(stored)}`);
  }

  for (const [search, stored] of [
    ["strasse", "Straße"],
    ["oresund", "Øresund"],
    ["galdoz", "Galdós"],
  ]) {
    assert.ok(!finds(search, stored), `${JSON.stringify(search)} does not find ${JSON.stringify(stored)}`);
  }
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
