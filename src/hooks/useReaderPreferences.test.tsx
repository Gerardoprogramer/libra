import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useReaderPreferences } from "./useReaderPreferences";

function ReaderPreferencesSnapshot() {
  const preferences = useReaderPreferences();

  return React.createElement(
    "output",
    null,
    `${preferences.theme}|${preferences.width}|${preferences.fontSize}|${preferences.isAvailable}`,
  );
}

test("reader preferences render deterministic defaults during server rendering", () => {
  Reflect.deleteProperty(globalThis, "window");

  assert.equal(
    renderToStaticMarkup(React.createElement(ReaderPreferencesSnapshot)),
    "<output>light|medium|20|true</output>",
  );
});
