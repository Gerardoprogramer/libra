import assert from "node:assert/strict";
import { test } from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getPathname, Link } from "@/i18n/navigation";
import { readingProgressHref } from "@/lib/reading-progress";

import { usePrefetchNextChapter } from "./usePrefetchNextChapter";

const nextHref = readingProgressHref({
  bookSlug: "dracula",
  chapterSlug: "chapter-2",
  editionId: "7b1f1d2c-3d4e-4f50-8a6b-7c8d9e0f1a2b",
});

function Reader({ progress }: { progress: number }) {
  const footerRef = useRef<HTMLElement>(null);
  usePrefetchNextChapter(nextHref, progress, footerRef);

  return (
    <footer ref={footerRef}>
      <Link href={nextHref} rel="next">
        Next
      </Link>
    </footer>
  );
}

function render(locale: "en" | "es", progress: number) {
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
        <Reader progress={progress} />
      </NextIntlClientProvider>
    </AppRouterContext.Provider>,
  );

  return { html, prefetched };
}

test("rendering a chapter on the server never prefetches the next one, even at the end", () => {
  for (const locale of ["es", "en"] as const) {
    assert.deepEqual(render(locale, 100).prefetched, []);
  }
});

test("the prefetched URL is the one the Next link navigates to: language, slug and edition", () => {
  for (const locale of ["es", "en"] as const) {
    const target = getPathname({ href: nextHref, locale });
    const { html } = render(locale, 0);

    assert.equal(target, `/${locale}/books/dracula/chapter-2?edition=7b1f1d2c-3d4e-4f50-8a6b-7c8d9e0f1a2b`);
    assert.ok(html.includes(`href="${target}"`), html);
  }
});
