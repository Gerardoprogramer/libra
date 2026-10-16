import assert from "node:assert/strict";
import { test } from "node:test";

import { routing } from "../i18n/routing";
import { LOCALE_HEADER, resolveNotFoundLocale } from "./not-found-locale";

test("a 404 outside any route uses the locale next-intl resolved", () => {
  assert.equal(resolveNotFoundLocale("es"), "es");
  assert.equal(resolveNotFoundLocale("en"), "en");
});

test("an absent or unrecognized locale falls back to the default locale and is never guessed", () => {
  for (const value of [null, undefined, "", "fr", "ES", "en-US", "es,en", "../en"]) {
    assert.equal(resolveNotFoundLocale(value), routing.defaultLocale, String(value));
  }
});

test("the locale header is the one next-intl sets", () => {
  assert.equal(LOCALE_HEADER, "x-next-intl-locale");
});
