import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  READER_PREFERENCES_CHANGE_EVENT,
  READER_PREFERENCES_STORAGE_KEY,
  getReaderPreferencesSnapshot,
  parseReaderPreferences,
  saveReaderPreferences,
  type ReaderPreferences,
} from "./reader-preferences";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function createBrowser() {
  const values = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });

  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });

  return { browser, values };
}

const defaults: ReaderPreferences = { theme: "light", width: "medium", fontSize: 20 };

test("reader preferences default safely without browser storage and during SSR", () => {
  Reflect.deleteProperty(globalThis, "window");

  assert.equal(getReaderPreferencesSnapshot(), null);
  assert.deepEqual(parseReaderPreferences(JSON.stringify(defaults)), defaults);
  assert.equal(saveReaderPreferences(defaults), false);
});

test("valid stored preferences are restored and font size is clamped to supported limits", () => {
  assert.deepEqual(parseReaderPreferences(JSON.stringify({ theme: "sepia", width: "wide", fontSize: 24 })), {
    theme: "sepia",
    width: "wide",
    fontSize: 24,
  });
  assert.equal(parseReaderPreferences(JSON.stringify({ ...defaults, fontSize: 1 })).fontSize, 16);
  assert.equal(parseReaderPreferences(JSON.stringify({ ...defaults, fontSize: 100 })).fontSize, 30);
});

test("corrupt JSON and unsupported preference values recover field-by-field", () => {
  assert.deepEqual(parseReaderPreferences("{"), defaults);
  assert.deepEqual(
    parseReaderPreferences(JSON.stringify({ theme: "neon", width: "full", fontSize: "large" })),
    defaults,
  );
  assert.deepEqual(parseReaderPreferences(JSON.stringify({ theme: "dark", width: "invalid", fontSize: 22 })), {
    theme: "dark",
    width: "medium",
    fontSize: 22,
  });
});

test("storage snapshots distinguish empty storage from blocked storage", () => {
  const { browser, values } = createBrowser();
  assert.equal(getReaderPreferencesSnapshot(), JSON.stringify(defaults));

  values.set(READER_PREFERENCES_STORAGE_KEY, JSON.stringify({ theme: "dark", width: "narrow", fontSize: 18 }));
  assert.equal(getReaderPreferencesSnapshot(), JSON.stringify({ theme: "dark", width: "narrow", fontSize: 18 }));

  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("Storage access denied");
    },
  });
  assert.equal(getReaderPreferencesSnapshot(), null);
});

test("saving preferences persists before notifying same-tab subscribers and preserves other keys", () => {
  const { browser, values } = createBrowser();
  const preferences = { theme: "sepia", width: "wide", fontSize: 24 } as const;
  let savedSnapshot: string | null = null;

  values.set("libra:progress:dracula", "existing progress");
  browser.addEventListener(READER_PREFERENCES_CHANGE_EVENT, () => {
    savedSnapshot = values.get(READER_PREFERENCES_STORAGE_KEY) ?? null;
  });

  assert.equal(saveReaderPreferences(preferences), true);
  assert.equal(savedSnapshot, JSON.stringify(preferences));
  assert.equal(values.get("libra:progress:dracula"), "existing progress");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    }),
  });
  assert.equal(getReaderPreferencesSnapshot(), JSON.stringify(preferences));
});

test("blocked and quota-limited storage never reports a successful save", () => {
  const { browser } = createBrowser();
  let notifications = 0;
  browser.addEventListener(READER_PREFERENCES_CHANGE_EVENT, () => notifications++);

  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("Storage access denied");
    },
  });
  assert.equal(saveReaderPreferences(defaults), false);

  const quotaBrowser = createBrowser();
  quotaBrowser.browser.localStorage.setItem = () => {
    throw new Error("Storage quota exceeded");
  };
  quotaBrowser.browser.addEventListener(READER_PREFERENCES_CHANGE_EVENT, () => notifications++);
  assert.equal(saveReaderPreferences(defaults), false);
  assert.equal(notifications, 0);
});
