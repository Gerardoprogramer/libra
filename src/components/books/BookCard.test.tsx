import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { load } from "cheerio";

import { BookCard } from "./BookCard";
import type { BookCategory, BookListItem } from "@/db/queries/books";

function makeBook(overrides: Partial<BookListItem> = {}): BookListItem {
  return {
    id: "book-1",
    slug: "dracula",
    title: "Dracula",
    author: "Bram Stoker",
    year: 1897,
    language: "en",
    coverUrl: null,
    categories: [],
    ...overrides,
  };
}

function makeCategory(id: string, slug: string, name: string): BookCategory {
  return { id, slug, name };
}

function renderBookCard(book: BookListItem, locale: "en" | "es" = "en") {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <BookCard book={book} />
    </NextIntlClientProvider>,
  );
}

test("BookCard links to the localized book detail and shows the category names supplied by the query", () => {
  const book = makeBook({
    categories: [makeCategory("classic", "classic-literature", "Literatura clásica")],
  });

  const spanish = renderBookCard(book, "es");
  const english = renderBookCard(
    makeBook({ categories: [makeCategory("classic", "classic-literature", "Classic Literature")] }),
    "en",
  );

  assert.match(spanish, /href="\/es\/books\/dracula"/);
  assert.match(spanish, /Literatura clásica/);
  assert.match(english, /href="\/en\/books\/dracula"/);
  assert.match(english, /Classic Literature/);
});

test("BookCard shows at most three categories while retaining Classic Literature", () => {
  const categories = [
    makeCategory("history", "history", "History"),
    makeCategory("travel", "travel", "Travel"),
    makeCategory("mystery", "mystery", "Mystery"),
    makeCategory("classic", "classic-literature", "Classic Literature"),
  ];
  const markup = renderBookCard(makeBook({ categories }));

  assert.match(markup, /History/);
  assert.match(markup, /Travel/);
  assert.match(markup, /Classic Literature/);
  assert.doesNotMatch(markup, /Mystery/);
  assert.equal((markup.match(/data-slot="badge"/g) ?? []).length, 3);
});

test("BookCard renders long book and author names without dropping them", () => {
  const title = "A Very Long Literary Title Intended to Remain Visible in a Responsive Card";
  const author = "An Author with a Deliberately Long Name";
  const markup = renderBookCard(makeBook({ title, author }));

  assert.ok(markup.includes(title));
  assert.ok(markup.includes(author));
});

test("BookCard handles missing categories and covers with the existing fallback cover", () => {
  const withoutCover = renderBookCard(makeBook());

  assert.doesNotMatch(withoutCover, /data-slot="badge"/);
  assert.match(withoutCover, /Dracula/);

  const withCover = renderBookCard(makeBook({ coverUrl: "/covers/dracula.jpg" }));
  assert.match(withCover, /<img/);
  assert.match(withCover, /alt=""/);
});

test("BookCard displays the edition language independently of the UI locale, cover and year", () => {
  for (const locale of ["en", "es"] as const) {
    for (const language of ["en", "es", "es-MX"]) {
      for (const coverUrl of [null, "/covers/dracula.jpg"]) {
        for (const year of [null, 1897]) {
          const $ = load(renderBookCard(makeBook({ language, coverUrl, year }), locale));
          const caption = $("h2").parent();
          assert.equal(caption.find("span").last().text(), language);
          assert.equal($("a").attr("href"), `/${locale}/books/dracula`);
          assert.equal($("article").length, 1);
        }
      }
    }
  }
});
