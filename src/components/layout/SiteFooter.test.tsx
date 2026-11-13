import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

import { SiteFooter } from "./SiteFooter";

test("the footer credits Project Gutenberg with a link, in both languages", () => {
  for (const messages of [es, en]) {
    const html = renderToStaticMarkup(
      <SiteFooter sourceLabel={messages.footer.source} noticeLabel={messages.footer.notice} />,
    );

    assert.match(html, /^<footer data-site-footer="true"/);
    assert.match(
      html,
      /<a href="https:\/\/www\.gutenberg\.org\/" target="_blank" rel="noopener noreferrer"[^>]*>Project Gutenberg<\/a>/,
    );
    assert.ok(html.includes(messages.footer.source), messages.footer.source);
  }
});

test("the notice states the public domain scope and that the MIT license covers only the code", () => {
  assert.match(es.footer.notice, /dominio público en Estados Unidos/);
  assert.match(es.footer.notice, /MIT[^.]*solo el código/);
  assert.match(en.footer.notice, /public domain in the United States/);
  assert.match(en.footer.notice, /MIT[^.]*only the code/);
});

test("the chapter page hides the footer together with the site header", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /> :is\(\[data-site-header\], \[data-site-footer\]\) \{\s*display: none;/);
});
