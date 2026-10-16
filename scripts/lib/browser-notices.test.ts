import assert from "node:assert/strict";
import { test } from "node:test";

import { EDGE_LAZY_IMAGE_NOTICE, isBenignBrowserNotice } from "./browser-notices.mjs";

test("only Edge's exact lazy-image info notice is treated as benign", () => {
  assert.equal(isBenignBrowserNotice({ level: "info", text: EDGE_LAZY_IMAGE_NOTICE }), true);
});

test("any other level, text or missing entry still fails the browser check", () => {
  for (const entry of [
    { level: "warning", text: EDGE_LAZY_IMAGE_NOTICE },
    { level: "error", text: EDGE_LAZY_IMAGE_NOTICE },
    { level: "info", text: `${EDGE_LAZY_IMAGE_NOTICE} ` },
    { level: "info", text: "Images loaded lazily and replaced with placeholders." },
    { level: "info", text: "Failed to load resource: the server responded with a status of 500" },
    { level: "error", text: "Hydration failed because the server rendered HTML didn't match the client." },
    { level: "info" },
    {},
    null,
    undefined,
  ]) {
    assert.equal(isBenignBrowserNotice(entry), false, JSON.stringify(entry));
  }
});
