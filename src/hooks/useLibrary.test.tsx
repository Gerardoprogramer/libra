import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useLibrary } from "./useLibrary";

function LibrarySnapshot() {
  const library = useLibrary();

  return React.createElement("output", null, `${library.isReady}|${library.isAvailable}|${library.entries.length}`);
}

test("My Library has a deterministic empty server snapshot before browser hydration", () => {
  Reflect.deleteProperty(globalThis, "window");

  assert.equal(renderToStaticMarkup(React.createElement(LibrarySnapshot)), "<output>false|false|0</output>");
});
