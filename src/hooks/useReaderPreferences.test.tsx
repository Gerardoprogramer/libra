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
    `${preferences.theme}|${preferences.width}|${preferences.fontSize}|${preferences.font}|${preferences.isAvailable}`,
  );
}

test("reader preferences render deterministic defaults during server rendering", () => {
  Reflect.deleteProperty(globalThis, "window");

  assert.equal(
    renderToStaticMarkup(React.createElement(ReaderPreferencesSnapshot)),
    "<output>light|medium|20|literata|true</output>",
  );
});

// The setters of a render: on the server the snapshot is the defaults, so setFont stores them with the new typeface.
type ReaderPreferencesResult = ReturnType<typeof useReaderPreferences>;

function Capture({ onRender }: { onRender: (preferences: ReaderPreferencesResult) => void }) {
  onRender(useReaderPreferences());
  return null;
}

function renderedSetters() {
  let setters: ReaderPreferencesResult | undefined;
  Reflect.deleteProperty(globalThis, "window");
  renderToStaticMarkup(React.createElement(Capture, { onRender: (preferences) => (setters = preferences) }));
  return setters!;
}

test("setFont stores the typeface with the other preferences and reports a failed save", () => {
  const { setFont } = renderedSetters();
  const values = new Map<string, string>();
  let notifications = 0;
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    },
  });
  browser.addEventListener("libra:reader-preferences-change", () => notifications++);
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });

  try {
    assert.equal(setFont("lexend"), true);
    assert.deepEqual(JSON.parse(values.get("libra:reader-preferences")!), {
      theme: "light",
      width: "medium",
      fontSize: 20,
      font: "lexend",
    });
    assert.equal(notifications, 1);

    browser.localStorage.setItem = () => {
      throw new Error("Storage quota exceeded");
    };
    assert.equal(setFont("georgia"), false);
    assert.equal(JSON.parse(values.get("libra:reader-preferences")!).font, "lexend");
    assert.equal(notifications, 1);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
