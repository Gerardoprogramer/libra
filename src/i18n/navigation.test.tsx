import assert from "node:assert/strict";
import { test } from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import { usePathname, useRouter } from "./navigation";

test("the navigation hooks used by LanguageSwitcher replace the locale and preserve the book slug both ways", (t) => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  for (const [locale, nextLocale] of [
    ["en", "es"],
    ["es", "en"],
  ] as const) {
    const destinations: string[] = [];
    const router: AppRouterInstance = {
      bfcacheId: "book-page",
      back() {},
      forward() {},
      refresh() {},
      push() {},
      prefetch() {},
      replace(href) {
        destinations.push(href);
      },
    };
    let changeLocale: (() => void) | undefined;

    function NavigationProbe() {
      const pathname = usePathname();
      const localizedRouter = useRouter();
      changeLocale = () => localizedRouter.replace(pathname, { locale: nextLocale });
      return <span>{pathname}</span>;
    }

    const markup = renderToStaticMarkup(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value={`/${locale}/books/dracula`}>
          <NextIntlClientProvider locale={locale} messages={{}}>
            <NavigationProbe />
          </NextIntlClientProvider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>,
    );

    assert.equal(markup, "<span>/books/dracula</span>");
    assert.ok(changeLocale);
    changeLocale();
    assert.deepEqual(destinations, [`/${nextLocale}/books/dracula`]);
  }
});
