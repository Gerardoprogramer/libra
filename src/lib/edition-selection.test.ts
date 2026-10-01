import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseEdition, type SelectableEdition } from "./edition-selection";

function edition(slug: string, language: string, isPreferred = false, createdAt = "2020-01-01") {
  return {
    slug,
    language,
    isPreferred,
    createdAt: new Date(createdAt),
  } satisfies SelectableEdition;
}

test("locale selection prefers an explicitly selected edition among same-language translations", () => {
  const editions = [
    edition("spanish-translation-a", "es", false, "2019-01-01"),
    edition("spanish-translation-b", "es", true, "2021-01-01"),
    edition("english-original", "en"),
  ];

  assert.equal(chooseEdition(editions, "es")?.slug, "spanish-translation-b");
  assert.equal(chooseEdition(editions, "en")?.slug, "english-original");
});

test("content-language regional subtags match the UI locale", () => {
  const editions = [edition("spanish-mexico", "es-mx")];

  assert.equal(chooseEdition(editions, "es")?.slug, "spanish-mexico");
  assert.equal(chooseEdition([edition("spanish-spain", "ES-ES")], "es")?.slug, "spanish-spain");
});

test("same-language editions without an editorial preference resolve deterministically", () => {
  const editions = [edition("later", "en", false, "2022-01-01"), edition("earlier", "en", false, "2018-01-01")];

  assert.equal(chooseEdition(editions, "en")?.slug, "earlier");
});

test("English remains the fallback when no edition matches the requested locale", () => {
  const editions = [edition("english-original", "en")];

  assert.equal(chooseEdition(editions, "es")?.slug, "english-original");
  assert.equal(chooseEdition([], "es"), undefined);
});
