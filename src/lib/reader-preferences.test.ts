import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  DEFAULT_READER_PREFERENCES,
  READER_MEASURES,
  READER_PREFERENCES_CHANGE_EVENT,
  READER_PREFERENCES_STORAGE_KEY,
  clearEarlyReaderPreferences,
  earlyReaderPreferencesScript,
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

// An <html> element with the parts of the DOM the early script and clearEarlyReaderPreferences use. Like the DOM, the
// style attribute appears with the first property and stays (empty) when the last one is removed.
function createRoot() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const writeStyle = () => {
    if (properties.size || attributes.has("style")) {
      attributes.set("style", [...properties].map(([name, value]) => `${name}: ${value};`).join(" "));
    }
  };

  return {
    attributes,
    properties,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, String(value)),
    removeAttribute: (name: string) => void attributes.delete(name),
    style: {
      setProperty: (name: string, value: string) => {
        properties.set(name, value);
        writeStyle();
      },
      removeProperty: (name: string) => {
        if (properties.delete(name)) writeStyle();
      },
    },
  };
}

type StorageListener = (event: { key: string | null }) => void;

// Runs the early script as the browser does, in a context of its own, against a stored value or blocked storage.
function runEarlyScript(stored: string | null | { blocked: true }) {
  const root = createRoot();
  const listeners: StorageListener[] = [];
  const localStorage = {
    getItem(key: string) {
      if (stored !== null && typeof stored === "object") throw new Error("Storage access denied");
      return key === READER_PREFERENCES_STORAGE_KEY ? stored : null;
    },
  };
  const addEventListener = (type: string, listener: StorageListener) => {
    if (type === "storage") listeners.push(listener);
  };

  runInNewContext(earlyReaderPreferencesScript, {
    document: { documentElement: root },
    localStorage,
    addEventListener,
  });

  return { root, listeners };
}

function earlyMarks(root: ReturnType<typeof createRoot>) {
  return {
    theme: root.getAttribute("data-reader-early-theme"),
    measured: root.getAttribute("data-reader-early-measure") !== null,
    fontSize: root.properties.get("--reader-early-font-size") ?? null,
    measure: root.properties.get("--reader-early-measure") ?? null,
  };
}

// What React renders for a stored value (useReaderPreferences: the snapshot, or the defaults when there is none or
// storage is blocked), expressed as the marks the early script should leave: none for a default.
function marksFor(stored: string | null) {
  const { theme, width, fontSize } = stored === null ? DEFAULT_READER_PREFERENCES : parseReaderPreferences(stored);
  const measured = fontSize !== DEFAULT_READER_PREFERENCES.fontSize || width !== DEFAULT_READER_PREFERENCES.width;

  return {
    theme: theme === DEFAULT_READER_PREFERENCES.theme ? null : theme,
    measured,
    // The same expressions as the article's inline style in ReaderView.
    fontSize: measured ? `${fontSize}px` : null,
    measure: measured ? `${READER_MEASURES[width] * fontSize}px` : null,
  };
}

const storedValues: (string | null)[] = [
  null,
  "",
  "{",
  "null",
  "5",
  '"dark"',
  "[]",
  '["dark"]',
  "{}",
  JSON.stringify(defaults),
  JSON.stringify({ theme: "sepia" }),
  JSON.stringify({ theme: "dark", width: "wide", fontSize: 26 }),
  JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 16 }),
  JSON.stringify({ theme: "light", width: "wide", fontSize: 20 }),
  JSON.stringify({ theme: "blue", width: "huge", fontSize: 99 }),
  JSON.stringify({ theme: "dark", fontSize: 4 }),
  JSON.stringify({ theme: "DARK", width: "Wide", fontSize: "22" }),
  JSON.stringify({ theme: ["dark"], width: ["wide"], fontSize: [22] }),
  JSON.stringify({ theme: { toString: "dark" }, width: null, fontSize: null }),
  JSON.stringify({ width: "narrow", fontSize: 21.5 }),
  JSON.stringify({ fontSize: -0 }),
  JSON.stringify({ fontSize: 30, width: "medium", theme: "sepia", extra: "ignored" }),
];

test("the early script leaves the marks of the preferences React renders, for every stored value", () => {
  for (const stored of storedValues) {
    assert.deepEqual(earlyMarks(runEarlyScript(stored).root), marksFor(stored), String(stored));
  }
});

test("the early script leaves no marks and throws nothing when storage is blocked", () => {
  const { root, listeners } = runEarlyScript({ blocked: true });

  assert.deepEqual(earlyMarks(root), marksFor(null));
  assert.equal(root.attributes.size, 0);
  assert.equal(listeners.length, 0);
});

test("the early script is a fixed string that never carries stored data", () => {
  const marker = "</script><script>alert(1)</script>";
  const { root } = runEarlyScript(JSON.stringify({ theme: marker, width: marker, fontSize: marker }));

  assert.equal(typeof earlyReaderPreferencesScript, "string");
  assert.ok(!earlyReaderPreferencesScript.includes("<"), "the inline script cannot close its own tag");
  assert.equal(root.attributes.size, 0);
  assert.equal(root.properties.size, 0);

  // Whatever is stored, only listed names and computed numbers are written.
  for (const stored of storedValues) {
    const marks = earlyMarks(runEarlyScript(stored).root);
    assert.ok(marks.theme === null || marks.theme === "sepia" || marks.theme === "dark", String(stored));
    for (const value of [marks.fontSize, marks.measure]) {
      assert.ok(value === null || /^\d+(\.\d+)?px$/.test(value), `${stored}: ${value}`);
    }
  }
});

test("a change of the stored preferences in another tab removes the early marks", () => {
  const { root, listeners } = runEarlyScript(JSON.stringify({ theme: "dark", width: "wide", fontSize: 26 }));
  assert.equal(listeners.length, 1);

  listeners[0]({ key: "libra:reading-progress:v2:guest:dracula" });
  assert.equal(earlyMarks(root).theme, "dark");

  listeners[0]({ key: READER_PREFERENCES_STORAGE_KEY });
  assert.deepEqual(earlyMarks(root), marksFor(null));
  assert.equal(root.getAttribute("style"), null);

  // Storage cleared in the other tab (key null), after the marks are gone: nothing left to remove.
  listeners[0]({ key: null });
  assert.equal(root.attributes.size, 0);
});

test("clearing the early marks is idempotent and leaves everything else on <html>", () => {
  const { root } = runEarlyScript(JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 16 }));
  root.setAttribute("lang", "es");
  root.setAttribute("class", "editorial");

  clearEarlyReaderPreferences(root as unknown as HTMLElement);
  clearEarlyReaderPreferences(root as unknown as HTMLElement);
  assert.deepEqual(earlyMarks(root), marksFor(null));
  assert.deepEqual(
    [...root.attributes],
    [
      ["lang", "es"],
      ["class", "editorial"],
    ],
  );

  // A style property that is not the script's survives, and so does the style attribute that holds it.
  const styled = runEarlyScript(JSON.stringify({ theme: "dark", fontSize: 24 })).root;
  styled.style.setProperty("--other", "1");
  clearEarlyReaderPreferences(styled as unknown as HTMLElement);
  assert.deepEqual(earlyMarks(styled), marksFor(null));
  assert.equal(styled.getAttribute("style"), "--other: 1;");

  // Nothing to remove.
  const clean = createRoot();
  clearEarlyReaderPreferences(clean as unknown as HTMLElement);
  assert.equal(clean.attributes.size, 0);
});
