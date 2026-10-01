import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

import LocaleError from "./error";

test("the localized route error presents translated retry guidance in English and Spanish", () => {
  for (const [locale, messages, expected] of [
    ["en", en, ["Something went wrong", "Please try again.", "Try again"]],
    ["es", es, ["Algo salió mal", "Inténtalo de nuevo.", "Reintentar"]],
  ] as const) {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LocaleError error={new Error("private detail")} retry={() => {}} />
      </NextIntlClientProvider>,
    );

    assert.ok(expected.every((text) => markup.includes(text)));
    assert.ok(!markup.includes("private detail"));
  }
});
