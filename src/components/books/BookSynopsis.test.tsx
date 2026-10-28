import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { load } from "cheerio";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { BookSynopsis } from "./BookSynopsis";

function render(text: string | null, locale: "en" | "es", lang: string = locale) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="UTC">
      <BookSynopsis text={text} lang={lang} />
    </NextIntlClientProvider>,
  );
}

test("a synopsis gets its own titled section, headed in the interface language", () => {
  for (const [locale, heading, text] of [
    ["es", "Sinopsis", "Una novela de aventuras publicada en 1883."],
    ["en", "Synopsis", "An adventure novel published in 1883."],
  ] as const) {
    const $ = load(render(`  ${text}  `, locale));
    const section = $("section");

    assert.equal(section.length, 1);
    assert.equal(section.attr("aria-labelledby"), "book-synopsis");
    // An h2, under the page's h1 (the title), as the chapter list's.
    assert.equal($("h2#book-synopsis").text(), heading);
    assert.equal(section.find("p").length, 1);
    assert.equal(section.find("p").text(), text);
    assert.equal(section.find("p").attr("lang"), locale);
    // Visible as it is: no button, disclosure or dialog to open first.
    assert.equal($("button, details, dialog, [hidden], [aria-hidden]").length, 0);
  }
});

test("the text keeps the language it is written in, not the interface's", () => {
  const $ = load(render("The edition's own words.", "es", "en"));

  assert.equal($("h2").text(), "Sinopsis");
  assert.equal($("p").attr("lang"), "en");
});

test("without text, not even the heading is rendered", () => {
  for (const locale of ["es", "en"] as const) {
    assert.equal(render(null, locale), "");
    assert.equal(render("", locale), "");
    assert.equal(render("   ", locale), "");
  }
});

// The synopsis is editorial text about the book, never part of it: only the book page renders it, not the reader.
test("only the book page renders the synopsis", () => {
  const root = new URL("../../", import.meta.url);
  const renderers = (readdirSync(root, { recursive: true }) as string[])
    .map((name) => name.split("\\").join("/"))
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .filter((name) => readFileSync(new URL(name, root), "utf8").includes("components/books/BookSynopsis"))
    .sort();

  assert.deepEqual(renderers, ["app/[locale]/books/[slug]/(book)/page.tsx"]);
});
