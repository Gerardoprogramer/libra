import assert from "node:assert/strict";
import { test } from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

import { PasswordUpdatedSessionOpen } from "./PasswordForms";

test("F-03: when the recovery session cannot be ended, the change stays a success with a warning in both languages", () => {
  for (const [locale, messages] of [
    ["en", en],
    ["es", es],
  ] as const) {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={{ auth: messages.auth }} timeZone="UTC">
        <PasswordUpdatedSessionOpen />
      </NextIntlClientProvider>,
    );

    assert.ok(markup.includes(messages.auth.passwordUpdatedTitle));
    assert.ok(markup.includes(messages.auth.passwordUpdatedSessionOpen));
    assert.ok(markup.includes('role="alert"'));
    assert.ok(!markup.includes(messages.auth.genericError));
  }
});
