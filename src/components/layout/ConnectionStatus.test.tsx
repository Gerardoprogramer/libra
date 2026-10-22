import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

import { ConnectionStatus } from "./ConnectionStatus";

test("on the server the status region is in the page, empty, so the first change is announced", () => {
  const html = renderToStaticMarkup(
    <ConnectionStatus offlineLabel={es.connection.offline} restoredLabel={es.connection.restored} />,
  );

  assert.match(html, /^<div role="status"[^>]*><\/div>$/);
  assert.doesNotMatch(html, /aria-hidden|tabindex/);
});

test("an open modal dialog does not hide the status region from screen readers", () => {
  const html = renderToStaticMarkup(
    <ConnectionStatus offlineLabel={en.connection.offline} restoredLabel={en.connection.restored} />,
  );

  // Radix modals hide every other element of the page except those with an aria-live attribute.
  assert.match(html, /^<div role="status" aria-live="polite"/);
});

test("the notice never blocks the page under it", () => {
  const html = renderToStaticMarkup(
    <ConnectionStatus offlineLabel={en.connection.offline} restoredLabel={en.connection.restored} />,
  );

  assert.match(html, /class="pointer-events-none fixed /);
});

test("the offline notice does not promise that content is available offline", () => {
  for (const message of [es.connection.offline, en.connection.offline]) {
    assert.doesNotMatch(message, /disponible|available|guardad|saved|descargad|download/i, message);
  }
});
