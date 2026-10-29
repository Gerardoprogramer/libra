import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStreamedSegments } from "./streamed-html";

// In-memory documents shaped like React's streamed HTML: no server or network access.
const document = (main: string, tail: string) =>
  `<!DOCTYPE html><html><head><title>T</title></head><body><main>${main}</main>${tail}</body></html>`;

test("a streamed segment is moved from its hidden div into its placeholder", () => {
  const { $, resolved } = resolveStreamedSegments(
    document(
      `<h1>Title</h1><template id="P:5"></template><h2>Chapters</h2>`,
      `<div hidden id="S:5"><section aria-labelledby="book-synopsis"><p>The synopsis.</p></section></div>` +
        `<script>$RS("S:5","P:5")</script>`,
    ),
  );

  assert.equal(resolved, 1);
  assert.equal($('main [aria-labelledby="book-synopsis"] p').text(), "The synopsis.");
  // In place: between the title and the next heading, and nowhere else.
  assert.deepEqual(
    $("main")
      .children()
      .map((_, element) => element.tagName)
      .get(),
    ["h1", "section", "h2"],
  );
  assert.equal($("[hidden]").length, 0);
  assert.equal($("template").length, 0);
});

test("a completed boundary replaces its fallback, nested boundaries included", () => {
  const { $, resolved } = resolveStreamedSegments(
    document(
      `<!--$?--><template id="B:0"></template><div class="skeleton"><!--$--><span>inner</span><!--/$--></div><!--/$--><footer>end</footer>`,
      `<div hidden id="S:0"><article>Loaded</article></div><script>$RC("B:0","S:0")</script>`,
    ),
  );

  assert.equal(resolved, 1);
  assert.equal($("main article").text(), "Loaded");
  assert.equal($("main .skeleton").length, 0);
  // Content after the boundary stays.
  assert.equal($("main footer").text(), "end");
});

test("segments nested in other segments resolve in document order", () => {
  const { $, resolved } = resolveStreamedSegments(
    document(
      `<template id="P:1"></template>`,
      `<div hidden id="S:1"><div class="outer"><template id="P:2"></template></div></div>` +
        `<div hidden id="S:2"><a href="/x">link</a></div>` +
        `<script>$RS("S:1","P:1");$RS("S:2","P:2")</script>`,
    ),
  );

  assert.equal(resolved, 2);
  assert.equal($("main .outer a").attr("href"), "/x");
});

test("a document without streamed segments is left as it is", () => {
  const html = document(`<h1>Title</h1><p>Body.</p>`, `<script>console.log("$RX")</script>`);
  const { $, resolved } = resolveStreamedSegments(html);

  assert.equal(resolved, 0);
  assert.equal($("main").text(), "TitleBody.");
});

test("a swap whose content or placeholder is missing changes nothing", () => {
  const { $, resolved } = resolveStreamedSegments(
    document(
      `<template id="P:9"></template>`,
      `<script>$RS("S:8","P:9");$RS("S:9","P:7")</script><div hidden id="S:9">late</div>`,
    ),
  );

  assert.equal(resolved, 0);
  assert.equal($("main template").length, 1);
  assert.equal($("div[hidden]").text(), "late");
});
