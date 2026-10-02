import assert from "node:assert/strict";
import { test } from "node:test";

import { load } from "cheerio";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import type { BookDetails } from "@/db/queries/books";
import { chooseEdition, type SelectableEdition } from "@/lib/edition-selection";
import { BookReadingAction } from "./BookReadingAction";
import { EditionDetails } from "./EditionDetails";

function edition(overrides: Partial<BookDetails["edition"] & SelectableEdition> = {}) {
  return {
    id: "edition-a",
    slug: "english-preferred",
    language: "en",
    title: "Dracula",
    description: null,
    translator: null,
    publicationYear: null,
    coverUrl: null,
    sourceName: null,
    sourceIdentifier: null,
    sourceUrl: null,
    copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",
    isPreferred: true,
    createdAt: new Date("2020-01-01"),
    ...overrides,
  } satisfies BookDetails["edition"] & SelectableEdition;
}

function renderEdition(selected: BookDetails["edition"], locale: "en" | "es" = "en") {
  return load(
    renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="UTC">
        <EditionDetails edition={selected} chapterCount={27} />
      </NextIntlClientProvider>,
    ),
  );
}

test("edition attribution and publication year use ES/EN messages and omit missing values", () => {
  for (const locale of ["en", "es"] as const) {
    const translated = renderEdition(edition({ translator: "Translator X", publicationYear: 2026 }), locale);
    assert.ok(
      translated.text().includes(locale === "en" ? "Translated by Translator X" : "Traducción de Translator X"),
    );
    assert.ok(translated.text().includes(locale === "en" ? "Edition from 2026" : "Edición de 2026"));

    const original = renderEdition(edition(), locale);
    assert.doesNotMatch(original.text(), /Translated by|Traducción de|Edition from|Edición de/);
    assert.equal(original("p").length, 0);
    assert.match(original("h2").text(), locale === "en" ? /This edition/ : /Esta edición/);
  }
});

test("source metadata handles every combination without empty labels or losing the external link", () => {
  for (const locale of ["en", "es"] as const) {
    for (const sourceName of [null, "Project Gutenberg"]) {
      for (const sourceIdentifier of [null, "174"]) {
        for (const sourceUrl of [null, "https://www.gutenberg.org/ebooks/174"]) {
          const $ = renderEdition(edition({ sourceName, sourceIdentifier, sourceUrl }), locale);
          const source = $("p");
          const prefix = locale === "en" ? "Source:" : "Fuente:";
          const identifier = locale === "en" ? "Identifier: 174" : "Identificador: 174";

          assert.equal(source.length, sourceName || sourceIdentifier || sourceUrl ? 1 : 0);
          assert.equal(source.text().includes(prefix), Boolean(sourceName));
          assert.equal(source.text().includes(identifier), Boolean(sourceIdentifier));
          if (sourceName) assert.ok(source.text().includes(sourceName));
          if (!sourceName && sourceIdentifier) assert.equal(source.text(), identifier);
          if (!sourceName && !sourceIdentifier && sourceUrl) {
            assert.equal(source.text(), locale === "en" ? "View source" : "Ver fuente");
          }

          assert.equal($("a").length, sourceUrl ? 1 : 0);
          if (sourceUrl) {
            assert.equal($("a").attr("href"), sourceUrl);
            assert.equal($("a").attr("target"), "_blank");
            assert.equal($("a").attr("rel"), "noopener noreferrer");
          }
        }
      }
    }
  }
});

test("source links reject unsafe protocols and malformed URLs while retaining attribution", () => {
  for (const sourceUrl of ["javascript:alert(1)", "data:text/html,example", "/internal-path", "invalid url"]) {
    const $ = renderEdition(edition({ sourceName: "Source archive", sourceUrl }));
    assert.equal($("a").length, 0);
    assert.match($("p").text(), /Source: Source archive/);
    assert.equal(renderEdition(edition({ sourceUrl }))("p").length, 0);
  }
});

test("only the preferred edition for each locale is presented and reading retains the work URL", () => {
  const editions = [
    edition({ slug: "english-alternative", isPreferred: false, translator: "Unselected translator" }),
    edition(),
    edition({ slug: "spanish-preferred", language: "es", translator: "Translator X" }),
  ];

  for (const locale of ["en", "es"] as const) {
    const selected = chooseEdition(editions, locale);
    assert.ok(selected);
    assert.equal(selected.slug, locale === "en" ? "english-preferred" : "spanish-preferred");
    const $ = renderEdition(selected, locale);
    assert.ok($.text().includes(locale === "en" ? "Language: English" : "Idioma: español"));
    assert.equal($.text().includes("Translator X"), locale === "es");
    assert.doesNotMatch($.text(), /Unselected translator|english-alternative/);
    assert.equal($("a, select, [role='combobox']").length, 0);

    const action = load(
      renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={{}}>
          <BookReadingAction
            bookSlug="dracula"
            chapterSlugs={["chapter-1"]}
            firstChapterSlug="chapter-1"
            startLabel="Read"
            continueLabel="Continue"
            readAgainLabel="Read again"
            progressLabel="{progress}%"
          />
        </NextIntlClientProvider>,
      ),
    );
    assert.equal(action("a").attr("href"), `/${locale}/books/dracula/chapter-1`);
  }
});

test("fallback presentation reports the selected edition language rather than the interface locale", () => {
  const selected = chooseEdition([edition()], "es");
  assert.ok(selected);
  assert.match(renderEdition(selected, "es").text(), /Idioma: inglés/);
  assert.match(renderEdition(edition({ language: "es-MX" }), "en").text(), /Language: Mexican Spanish/);
  assert.match(renderEdition(edition({ language: "invalid_tag" }), "en").text(), /Language: invalid_tag/);
});
