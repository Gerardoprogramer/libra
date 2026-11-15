import assert from "node:assert/strict";
import { test } from "node:test";

import { internalLinks, isNoindex, sourceKind, summarizeNoindexLinks, targetKind } from "./link-audit";

test("pages are classified by their path", () => {
  assert.equal(sourceKind("/es"), "home");
  assert.equal(sourceKind("/en/books"), "catalog");
  assert.equal(sourceKind("/es/books/dracula"), "book");
  assert.equal(sourceKind("/en/books/dracula/chapter-1"), "reader");
  assert.equal(sourceKind("/es/authors"), "authors");
  assert.equal(sourceKind("/en/authors/bram-stoker"), "authors");
  assert.equal(sourceKind("/es/categories"), "categories");
  assert.equal(sourceKind("/es/login"), "other");
  assert.equal(targetKind("/es/books/dracula"), "book");
  assert.equal(targetKind("/es/books/dracula/chapter-1"), "chapter");
  assert.equal(targetKind("/es/books"), "other");
});

test("internal links keep the query, drop fragments, repeats, other origins and non-page paths", () => {
  const html = `
    <a href="/es/books/dracula">a</a>
    <a href="/es/books/dracula#top">again</a>
    <a href="/es/books?category=adventure&amp;page=2">b</a>
    <a href="chapter-1">relative</a>
    <a href="https://example.com/x">external</a>
    <a href="/api/reading-progress">api</a>
    <a href="/es/books/dracula/opengraph-image">image</a>
    <a href="/icon.svg">file</a>
    <a>no href</a>`;

  assert.deepEqual(internalLinks(html, new URL("http://localhost:3000/es/books/dracula/")), [
    "/es/books/dracula",
    "/es/books?category=adventure&page=2",
    "/es/books/dracula/chapter-1",
  ]);
});

test("noindex is read from the robots and googlebot metas and from X-Robots-Tag", () => {
  assert.equal(isNoindex('<meta name="robots" content="noindex, follow">', null), true);
  assert.equal(isNoindex('<meta name="googlebot" content="noindex">', null), true);
  assert.equal(isNoindex('<meta name="robots" content="index, follow">', null), false);
  assert.equal(isNoindex("", "noindex"), true);
  assert.equal(isNoindex("", null), false);
});

test("links to noindex pages are counted by kind of target and of source", () => {
  const summary = summarizeNoindexLinks(
    [
      { source: "/es/books", target: "/es/books/en-book" },
      { source: "/es/books?category=adventure", target: "/es/books/en-book" },
      { source: "/es/books/en-book", target: "/es/books/en-book/chapter-1" },
      { source: "/es/books/en-book/chapter-1", target: "/es/login" },
      { source: "/es", target: "/es/books/es-book" },
    ],
    new Set(["/es/books/en-book", "/es/books/en-book/chapter-1", "/es/login"]),
  );

  assert.equal(summary.total, 4);
  assert.equal(summary.distinctTargets, 3);
  assert.deepEqual(summary.byTarget, { book: 2, chapter: 1, other: 1 });
  assert.equal(summary.bySource.catalog, 2);
  assert.equal(summary.bySource.book, 1);
  assert.equal(summary.bySource.reader, 1);
  assert.equal(summary.bySource.home, 0);
  assert.equal(summary.matrix.catalog.book, 2);
  assert.equal(summary.matrix.reader.other, 1);
});
