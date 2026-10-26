import assert from "node:assert/strict";
import { test } from "node:test";

import { load } from "cheerio";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { WorkDescription } from "./WorkDescription";

function render(description: string | null, locale: "en" | "es") {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="UTC">
      <WorkDescription description={description} lang={locale} />
    </NextIntlClientProvider>,
  );
}

test("a published description gets its own titled section, in the interface language", () => {
  for (const [locale, heading, text] of [
    ["es", "Sobre esta obra", "Una novela de 1897."],
    ["en", "About this work", "A novel from 1897."],
  ] as const) {
    const $ = load(render(text, locale));
    const section = $("section");

    assert.equal(section.length, 1);
    assert.equal(section.attr("aria-labelledby"), "about-this-work");
    assert.equal($("h2#about-this-work").text(), heading);
    assert.equal(section.find("p").text(), text);
    assert.equal(section.find("p").attr("lang"), locale);
  }
});

test("without a published description, not even the heading is rendered", () => {
  for (const locale of ["es", "en"] as const) {
    assert.equal(render(null, locale), "");
    assert.equal(render("", locale), "");
  }
});
