import assert from "node:assert/strict";
import { test } from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

import { AuthForm } from "./AuthForm";

const router: AppRouterInstance = {
  bfcacheId: "auth-form",
  back() {},
  forward() {},
  refresh() {},
  push() {},
  prefetch() {},
  replace() {},
};

function render(locale: "en" | "es", props: Parameters<typeof AuthForm>[0]) {
  const messages = locale === "en" ? en : es;

  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <NextIntlClientProvider locale={locale} messages={{ auth: messages.auth }} timeZone="UTC">
        <AuthForm {...props} />
      </NextIntlClientProvider>
    </AppRouterContext.Provider>,
  );
}

test("F-03: after a reset the login page tells the user to sign in with the new password, in both languages", () => {
  for (const [locale, messages] of [
    ["en", en],
    ["es", es],
  ] as const) {
    const notice = messages.auth.passwordResetSignIn;

    assert.ok(render(locale, { mode: "login", passwordReset: true }).includes(notice));
    assert.ok(!render(locale, { mode: "login" }).includes(notice));
    // A failed callback is the more urgent message and replaces it.
    const withError = render(locale, { mode: "login", passwordReset: true, callbackError: true });
    assert.ok(withError.includes(messages.auth.callbackError));
    assert.ok(!withError.includes(notice));
  }
});
