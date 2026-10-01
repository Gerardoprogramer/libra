import assert from "node:assert/strict";
import { test } from "node:test";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { compareLocaleMessages } from "./message-parity";

test("English and Spanish translation trees have matching nested keys and placeholders", () => {
  assert.deepEqual(compareLocaleMessages(en, es), []);
});

test("translation parity detects nested missing, additional, and differently shaped values", () => {
  const differences = compareLocaleMessages(
    {
      home: {
        title: "Hello {name}",
        nav: { books: "Books" },
        nested: { detail: { text: "Nested value" } },
      },
    },
    {
      home: {
        title: "Hola {name}",
        nav: { authors: "Autores" },
        extra: "Extra",
        nested: { detail: "Valor no anidado" },
      },
    },
  );

  assert.deepEqual(
    differences.map(({ path, kind }) => [path, kind]),
    [
      ["home.extra", "additional-key"],
      ["home.nav.authors", "additional-key"],
      ["home.nav.books", "missing-key"],
      ["home.nested.detail", "structure-mismatch"],
    ],
  );
});

test("translation parity detects mismatched ICU placeholders at any nesting level", () => {
  const differences = compareLocaleMessages(
    { catalog: { result: "{count, plural, one {# item} other {# items}}", greeting: "Hello {name}" } },
    { catalog: { result: "{total, plural, one {# elemento} other {# elementos}}", greeting: "Hola {person}" } },
  );

  assert.deepEqual(
    differences.map(({ path, kind }) => [path, kind]),
    [
      ["catalog.greeting", "placeholder-mismatch"],
      ["catalog.result", "placeholder-mismatch"],
    ],
  );
});
