import assert from "node:assert/strict";
import { test } from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getPathname, Link } from "@/i18n/navigation";
import { readingProgressHref } from "@/lib/reading-progress";

import { hasKeyboardFocus, usePrefetchNextChapter } from "./usePrefetchNextChapter";

const nextHref = readingProgressHref({
  bookSlug: "dracula",
  chapterSlug: "chapter-2",
  editionId: "7b1f1d2c-3d4e-4f50-8a6b-7c8d9e0f1a2b",
});

function Reader() {
  const footerRef = useRef<HTMLElement>(null);
  const { linkPrefetch, onLinkFocus } = usePrefetchNextChapter(nextHref, footerRef);

  return (
    <footer ref={footerRef} data-link-prefetch={String(linkPrefetch)}>
      <Link href={nextHref} rel="next" prefetch={linkPrefetch} onFocus={onLinkFocus}>
        Next
      </Link>
    </footer>
  );
}

function render(locale: "en" | "es") {
  const prefetched: string[] = [];
  const router: AppRouterInstance = {
    bfcacheId: "reader",
    back() {},
    forward() {},
    refresh() {},
    push() {},
    prefetch(href) {
      prefetched.push(href);
    },
    replace() {},
  };

  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <NextIntlClientProvider locale={locale} messages={{}} timeZone="UTC">
        <Reader />
      </NextIntlClientProvider>
    </AppRouterContext.Provider>,
  );

  return { html, prefetched };
}

test("on the server the next chapter is not prefetched and its link keeps the default prefetch", () => {
  for (const locale of ["es", "en"] as const) {
    const { html, prefetched } = render(locale);

    assert.deepEqual(prefetched, []);
    // The full prefetch is enabled only after mounting, once the connection is known, so hydration matches.
    assert.ok(html.includes('data-link-prefetch="auto"'), html);
  }
});

test("the prefetched URL is the one the Next link navigates to: language, slug and edition", () => {
  for (const locale of ["es", "en"] as const) {
    const target = getPathname({ href: nextHref, locale });
    const { html } = render(locale);

    assert.equal(target, `/${locale}/books/dracula/chapter-2?edition=7b1f1d2c-3d4e-4f50-8a6b-7c8d9e0f1a2b`);
    assert.ok(html.includes(`href="${target}"`), html);
  }
});

test("only keyboard focus counts, and a browser without :focus-visible never breaks the focus handler", () => {
  const selectors: string[] = [];
  const element = (focusVisible: boolean) => ({
    matches(selector: string) {
      selectors.push(selector);
      return focusVisible;
    },
  });

  assert.equal(hasKeyboardFocus(element(true)), true);
  assert.equal(hasKeyboardFocus(element(false)), false);
  assert.deepEqual(selectors, [":focus-visible", ":focus-visible"]);

  const unsupported = {
    matches(): boolean {
      throw new SyntaxError("':focus-visible' is not a valid selector");
    },
  };
  assert.doesNotThrow(() => hasKeyboardFocus(unsupported));
  assert.equal(hasKeyboardFocus(unsupported), false);
});
