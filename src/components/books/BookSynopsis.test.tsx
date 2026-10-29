import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { load } from "cheerio";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { BookSynopsis } from "./BookSynopsis";
import { getSynopsisView } from "./SynopsisText";

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
    // Never behind a disclosure, a dialog or anything hidden: the whole text is in the HTML.
    assert.equal($("details, dialog, [hidden], p[aria-hidden]").length, 0);
  }
});

test("a long synopsis starts clamped, with a toggle labelled in the interface language", () => {
  const long = "Una frase larga sobre el libro que se repite para llenar varias líneas. ".repeat(12).trim();

  for (const [locale, more] of [
    ["es", "Leer más"],
    ["en", "Read more"],
  ] as const) {
    const $ = load(render(long, locale));
    const text = $("p");
    const toggle = $("button");

    // Clamped by CSS, never cut: every word of the synopsis is still in the markup for search engines.
    assert.ok(text.attr("class")?.split(" ").includes("line-clamp-4"));
    assert.equal(text.text(), long);

    assert.equal(toggle.length, 1);
    assert.equal(toggle.attr("type"), "button");
    assert.equal(toggle.text(), more);
    assert.equal(toggle.attr("aria-expanded"), "false");
    // The toggle names the text it controls.
    assert.ok(text.attr("id"));
    assert.equal(toggle.attr("aria-controls"), text.attr("id"));
    // Its icon is decoration: the label alone is read.
    assert.equal(toggle.find("svg").attr("aria-hidden"), "true");
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

test("the synopsis expands and collapses, offering the toggle only when the text needs it", () => {
  // Collapsed and longer than its lines: clamped, with "Read more".
  assert.deepEqual(getSynopsisView(false, true), { clamped: true, showToggle: true, label: "more" });
  // Expanded: the whole text, with "Read less" to collapse it again, whatever the clamped text measured.
  assert.deepEqual(getSynopsisView(true, true), { clamped: false, showToggle: true, label: "less" });
  assert.deepEqual(getSynopsisView(true, false), { clamped: false, showToggle: true, label: "less" });
  // A short text that fits in its lines: no toggle to offer.
  assert.deepEqual(getSynopsisView(false, false), { clamped: true, showToggle: false, label: "more" });
});

test("the labels of the toggle exist in every language", () => {
  assert.equal(es.book.readMore, "Leer más");
  assert.equal(es.book.readLess, "Leer menos");
  assert.equal(en.book.readMore, "Read more");
  assert.equal(en.book.readLess, "Read less");
});

// The paragraph and its toggle belong to the synopsis section alone, never to the reader or a chapter.
test("only the synopsis section renders the expandable text", () => {
  const root = new URL("../../", import.meta.url);
  const renderers = (readdirSync(root, { recursive: true }) as string[])
    .map((name) => name.split("\\").join("/"))
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .filter((name) =>
      /from "\.\/SynopsisText"|components\/books\/SynopsisText/.test(readFileSync(new URL(name, root), "utf8")),
    )
    .sort();

  assert.deepEqual(renderers, ["components/books/BookSynopsis.tsx"]);
});
