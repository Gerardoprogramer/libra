import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  DEFAULT_READER_PREFERENCES,
  READER_DARK_THEME_COLOR,
  READER_FONTS,
  READER_LINE_HEIGHTS,
  READER_LINE_SPACINGS,
  READER_SIDE_MARGINS,
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

const defaults: ReaderPreferences = {
  theme: "light",
  width: "medium",
  fontSize: 20,
  font: "literata",
  lineSpacing: "normal",
};

test("reader preferences default safely without browser storage and during SSR", () => {
  Reflect.deleteProperty(globalThis, "window");

  assert.equal(getReaderPreferencesSnapshot(), null);
  assert.deepEqual(parseReaderPreferences(JSON.stringify(defaults)), defaults);
  assert.equal(saveReaderPreferences(defaults), false);
});

test("valid stored preferences are restored and font size is clamped to supported limits", () => {
  assert.deepEqual(
    parseReaderPreferences(
      JSON.stringify({ theme: "sepia", width: "wide", fontSize: 24, font: "merriweather", lineSpacing: "relaxed" }),
    ),
    { theme: "sepia", width: "wide", fontSize: 24, font: "merriweather", lineSpacing: "relaxed" },
  );
  assert.equal(parseReaderPreferences(JSON.stringify({ ...defaults, fontSize: 1 })).fontSize, 16);
  assert.equal(parseReaderPreferences(JSON.stringify({ ...defaults, fontSize: 100 })).fontSize, 30);
});

test("corrupt JSON and unsupported preference values recover field-by-field", () => {
  assert.deepEqual(parseReaderPreferences("{"), defaults);
  assert.deepEqual(
    parseReaderPreferences(
      JSON.stringify({ theme: "neon", width: "full", fontSize: "large", font: "comic", lineSpacing: "double" }),
    ),
    defaults,
  );
  assert.deepEqual(parseReaderPreferences(JSON.stringify({ theme: "dark", width: "invalid", fontSize: 22 })), {
    theme: "dark",
    width: "medium",
    fontSize: 22,
    font: "literata",
    lineSpacing: "normal",
  });
});

test("each listed typeface is restored, independently of the other preferences", () => {
  assert.deepEqual(READER_FONTS, ["literata", "georgia", "merriweather", "lexend"]);
  assert.equal(DEFAULT_READER_PREFERENCES.font, "literata");

  for (const font of READER_FONTS) {
    assert.deepEqual(parseReaderPreferences(JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 18, font })), {
      theme: "sepia",
      width: "narrow",
      fontSize: 18,
      font,
      lineSpacing: "normal",
    });
    // An unsupported value elsewhere does not reset the typeface.
    assert.equal(parseReaderPreferences(JSON.stringify({ theme: "neon", fontSize: "big", font })).font, font);
  }
});

test("preferences stored before typefaces existed keep their values and read Literata", () => {
  assert.deepEqual(parseReaderPreferences(JSON.stringify({ theme: "dark", width: "wide", fontSize: 26 })), {
    theme: "dark",
    width: "wide",
    fontSize: 26,
    font: "literata",
    lineSpacing: "normal",
  });
});

test("an unsupported typeface falls back to Literata and keeps the other preferences", () => {
  for (const font of ["Lexend", "LEXEND", "comic-sans", "", null, 1, ["lexend"], { name: "lexend" }, "literata "]) {
    assert.deepEqual(
      parseReaderPreferences(JSON.stringify({ theme: "sepia", width: "wide", fontSize: 24, font })),
      { theme: "sepia", width: "wide", fontSize: 24, font: "literata", lineSpacing: "normal" },
      JSON.stringify(font),
    );
  }
});

test("each line spacing is restored, independently of the other preferences", () => {
  assert.deepEqual(READER_LINE_SPACINGS, ["compact", "normal", "relaxed"]);
  assert.deepEqual(READER_LINE_HEIGHTS, { compact: 1.5, normal: 1.65, relaxed: 1.8 });
  assert.equal(DEFAULT_READER_PREFERENCES.lineSpacing, "normal");

  for (const lineSpacing of READER_LINE_SPACINGS) {
    assert.deepEqual(
      parseReaderPreferences(
        JSON.stringify({ theme: "dark", width: "wide", fontSize: 22, font: "lexend", lineSpacing }),
      ),
      { theme: "dark", width: "wide", fontSize: 22, font: "lexend", lineSpacing },
    );
    // An unsupported value elsewhere does not reset the spacing.
    assert.equal(
      parseReaderPreferences(JSON.stringify({ theme: "neon", font: "comic", lineSpacing })).lineSpacing,
      lineSpacing,
    );
  }
});

test("preferences stored before line spacing existed keep their values and read normal", () => {
  assert.deepEqual(
    parseReaderPreferences(JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 18, font: "georgia" })),
    { theme: "sepia", width: "narrow", fontSize: 18, font: "georgia", lineSpacing: "normal" },
  );
});

test("an unsupported line spacing falls back to normal and keeps the other preferences", () => {
  for (const lineSpacing of [
    "Relaxed",
    "COMPACT",
    "double",
    "",
    null,
    1.8,
    ["relaxed"],
    { value: "compact" },
    " compact",
  ]) {
    assert.deepEqual(
      parseReaderPreferences(
        JSON.stringify({ theme: "dark", width: "wide", fontSize: 24, font: "merriweather", lineSpacing }),
      ),
      { theme: "dark", width: "wide", fontSize: 24, font: "merriweather", lineSpacing: "normal" },
      JSON.stringify(lineSpacing),
    );
  }
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
  const preferences = { theme: "sepia", width: "wide", fontSize: 24, font: "lexend", lineSpacing: "relaxed" } as const;
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

// An <html> element with the parts of the DOM the early script and clearEarlyReaderPreferences use, in a document whose
// <head> holds the site's theme-color meta. Like the DOM, the style attribute appears with the first property and
// stays (empty) when the last one is removed.
function createRoot() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const writeStyle = () => {
    if (properties.size || attributes.has("style")) {
      attributes.set("style", [...properties].map(([name, value]) => `${name}: ${value};`).join(" "));
    }
  };
  const head: FakeElement[] = [];
  const loaded: (() => void)[] = [];
  const document = {
    // Whether a reader or its placeholder is in the page once it has loaded.
    hasReader: true,
    head: {
      children: head,
      prepend: (element: FakeElement) => void head.unshift(element),
    },
    createElement: () => {
      const element: FakeElement = {
        attributes: new Map(),
        getAttribute: (name) => element.attributes.get(name) ?? null,
        setAttribute: (name, value) => void element.attributes.set(name, String(value)),
        remove: () => void (head.includes(element) && head.splice(head.indexOf(element), 1)),
      };
      return element;
    },
    querySelector(selector: string) {
      if (selector === "[data-reader-theme],[data-reader-pending]") return document.hasReader ? {} : null;
      const attribute = /^meta\[([\w-]+)\]$/.exec(selector)?.[1];
      assert.ok(attribute, selector);
      return head.find((element) => element.attributes.has(attribute)) ?? null;
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "DOMContentLoaded") loaded.push(listener);
    },
    load: () => loaded.splice(0).forEach((listener) => listener()),
  };
  const site = document.createElement();
  site.setAttribute("name", "theme-color");
  site.setAttribute("content", "#fcfaf6");
  head.push(site);

  const root = {
    attributes,
    properties,
    ownerDocument: document,
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
  return root;
}

interface FakeElement {
  attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

type StorageListener = (event: { key: string | null }) => void;

// Runs the early script as the browser does, in a context of its own, against a stored value or blocked storage, on a
// chapter's URL unless another is given.
function runEarlyScript(stored: string | null | { blocked: true }, pathname = "/en/books/dracula/chapter-1") {
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
    document: Object.assign(root.ownerDocument, { documentElement: root }),
    location: { pathname },
    localStorage,
    addEventListener,
  });

  return { root, listeners };
}

// The color the browser's bar shows: the first theme-color meta's.
function barColor(root: ReturnType<typeof createRoot>) {
  return root.ownerDocument.head.children
    .find((element) => element.getAttribute("name") === "theme-color")!
    .getAttribute("content");
}

function earlyMarks(root: ReturnType<typeof createRoot>) {
  return {
    theme: root.getAttribute("data-reader-early-theme"),
    font: root.getAttribute("data-reader-early-font"),
    lineSpacing: root.getAttribute("data-reader-early-line-spacing"),
    width: root.getAttribute("data-reader-early-width"),
    measured: root.getAttribute("data-reader-early-measure") !== null,
    fontSize: root.properties.get("--reader-early-font-size") ?? null,
    measure: root.properties.get("--reader-early-measure") ?? null,
    themeColor: barColor(root),
  };
}

// What React renders for a stored value (useReaderPreferences: the snapshot, or the defaults when there is none or
// storage is blocked), expressed as the marks the early script should leave: none for a default.
function marksFor(stored: string | null) {
  const { theme, width, fontSize, font, lineSpacing } =
    stored === null ? DEFAULT_READER_PREFERENCES : parseReaderPreferences(stored);
  const measured = fontSize !== DEFAULT_READER_PREFERENCES.fontSize || width !== DEFAULT_READER_PREFERENCES.width;

  return {
    theme: theme === DEFAULT_READER_PREFERENCES.theme ? null : theme,
    // The article's data-reader-font in ReaderView.
    font: font === DEFAULT_READER_PREFERENCES.font ? null : font,
    // The article's data-reader-line-spacing in ReaderView.
    lineSpacing: lineSpacing === DEFAULT_READER_PREFERENCES.lineSpacing ? null : lineSpacing,
    // The reader main's data-reader-width in ReaderView, which sets the side margin.
    width: width === DEFAULT_READER_PREFERENCES.width ? null : width,
    measured,
    // The same expressions as the article's inline style in ReaderView.
    fontSize: measured ? `${fontSize}px` : null,
    measure: measured ? `${READER_MEASURES[width] * fontSize}px` : null,
    // The bar's color useReaderThemeColor gives the reader (src/lib/reader-theme-color.ts); the site's otherwise.
    themeColor: theme === "dark" ? READER_DARK_THEME_COLOR : "#fcfaf6",
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
  JSON.stringify({ font: "literata" }),
  JSON.stringify({ font: "georgia" }),
  JSON.stringify({ font: "merriweather", theme: "dark" }),
  JSON.stringify({ font: "lexend", width: "wide", fontSize: 24 }),
  JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 18, font: "lexend" }),
  JSON.stringify({ font: "Lexend", theme: "dark" }),
  JSON.stringify({ font: "comic-sans", fontSize: 22 }),
  JSON.stringify({ font: ["georgia"] }),
  JSON.stringify({ font: null, theme: "sepia" }),
  JSON.stringify({ font: { toString: "lexend" } }),
  JSON.stringify({ lineSpacing: "normal" }),
  JSON.stringify({ lineSpacing: "compact" }),
  JSON.stringify({ lineSpacing: "relaxed", theme: "dark" }),
  JSON.stringify({ lineSpacing: "relaxed", font: "lexend", width: "wide", fontSize: 24 }),
  JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 18, font: "georgia", lineSpacing: "compact" }),
  JSON.stringify({ lineSpacing: "Relaxed", theme: "dark" }),
  JSON.stringify({ lineSpacing: "double", fontSize: 22 }),
  JSON.stringify({ lineSpacing: 1.8 }),
  JSON.stringify({ lineSpacing: ["compact"] }),
  JSON.stringify({ lineSpacing: null, font: "merriweather" }),
  JSON.stringify({ lineSpacing: { toString: "relaxed" } }),
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
  const { root } = runEarlyScript(
    JSON.stringify({ theme: marker, width: marker, fontSize: marker, font: marker, lineSpacing: marker }),
  );

  assert.equal(typeof earlyReaderPreferencesScript, "string");
  assert.ok(!earlyReaderPreferencesScript.includes("<"), "the inline script cannot close its own tag");
  assert.equal(root.attributes.size, 0);
  assert.equal(root.properties.size, 0);

  // Whatever is stored, only listed names and computed numbers are written.
  for (const stored of storedValues) {
    const marks = earlyMarks(runEarlyScript(stored).root);
    assert.ok(marks.theme === null || marks.theme === "sepia" || marks.theme === "dark", String(stored));
    assert.ok(marks.font === null || ["georgia", "merriweather", "lexend"].includes(marks.font), String(stored));
    assert.ok(marks.lineSpacing === null || ["compact", "relaxed"].includes(marks.lineSpacing), String(stored));
    assert.ok(marks.width === null || ["narrow", "wide"].includes(marks.width), String(stored));
    for (const value of [marks.fontSize, marks.measure]) {
      assert.ok(value === null || /^\d+(\.\d+)?px$/.test(value), `${stored}: ${value}`);
    }
    assert.ok([READER_DARK_THEME_COLOR, "#fcfaf6"].includes(marks.themeColor!), String(stored));
  }
});

test("before hydration, a stored dark theme gives the bar its color only on a chapter's URL, ahead of the site's", () => {
  const dark = JSON.stringify({ theme: "dark", width: "wide", fontSize: 22 });

  for (const pathname of ["/en/books/dracula/chapter-1", "/es/books/quijote/capitulo-3", "/es/books/quijote/3/"]) {
    const { root } = runEarlyScript(dark, pathname);
    const [first, site] = root.ownerDocument.head.children;
    assert.equal(barColor(root), READER_DARK_THEME_COLOR, pathname);
    assert.equal(first.getAttribute("data-reader-early-theme-color"), "", pathname);
    assert.equal(site.getAttribute("content"), "#fcfaf6", pathname);
  }
  // The home, the catalog, a book's page and anything deeper or elsewhere keep the site's color: they have no reader.
  for (const pathname of ["/", "/en", "/en/books", "/en/books/dracula", "/en/books/dracula/1/x", "/en/authors/a/b"]) {
    const { root } = runEarlyScript(dark, pathname);
    assert.equal(barColor(root), "#fcfaf6", pathname);
    assert.equal(root.ownerDocument.head.children.length, 1, pathname);
    // The surface's own marks are written as before: globals.css applies them only where there is a reader.
    assert.equal(earlyMarks(root).theme, "dark", pathname);
  }
  for (const stored of [JSON.stringify({ theme: "sepia" }), JSON.stringify({ theme: "light" }), null]) {
    assert.equal(barColor(runEarlyScript(stored).root), "#fcfaf6", String(stored));
  }
});

test("the early bar color goes once the page has loaded without a reader, and stays while one is there", () => {
  const dark = JSON.stringify({ theme: "dark" });

  // A chapter URL that renders a not-found or error page.
  const missing = runEarlyScript(dark).root;
  missing.ownerDocument.hasReader = false;
  missing.ownerDocument.load();
  assert.equal(barColor(missing), "#fcfaf6");
  assert.equal(missing.ownerDocument.head.children.length, 1);

  const reader = runEarlyScript(dark).root;
  reader.ownerDocument.load();
  assert.equal(barColor(reader), READER_DARK_THEME_COLOR);
  // Then the reader, once React renders the same theme, removes the marks, this color included: by then its own
  // (useReaderThemeColor) is in place.
  clearEarlyReaderPreferences(reader as unknown as HTMLElement);
  assert.equal(barColor(reader), "#fcfaf6");
});

test("a change of the stored preferences in another tab removes the early marks", () => {
  const { root, listeners } = runEarlyScript(
    JSON.stringify({ theme: "dark", width: "wide", fontSize: 26, font: "merriweather", lineSpacing: "relaxed" }),
  );
  assert.equal(listeners.length, 1);

  listeners[0]({ key: "libra:reading-progress:v2:guest:dracula" });
  assert.equal(earlyMarks(root).theme, "dark");
  assert.equal(earlyMarks(root).font, "merriweather");
  assert.equal(earlyMarks(root).lineSpacing, "relaxed");
  assert.equal(earlyMarks(root).width, "wide");

  listeners[0]({ key: READER_PREFERENCES_STORAGE_KEY });
  assert.deepEqual(earlyMarks(root), marksFor(null));
  assert.equal(root.getAttribute("style"), null);

  // Storage cleared in the other tab (key null), after the marks are gone: nothing left to remove.
  listeners[0]({ key: null });
  assert.equal(root.attributes.size, 0);
});

test("clearing the early marks is idempotent and leaves everything else on <html>", () => {
  const { root } = runEarlyScript(
    JSON.stringify({ theme: "sepia", width: "narrow", fontSize: 16, font: "lexend", lineSpacing: "compact" }),
  );
  assert.equal(earlyMarks(root).font, "lexend");
  assert.equal(earlyMarks(root).lineSpacing, "compact");
  assert.equal(earlyMarks(root).width, "narrow");
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
  const styled = runEarlyScript(JSON.stringify({ theme: "dark", fontSize: 24, font: "georgia" })).root;
  styled.style.setProperty("--other", "1");
  clearEarlyReaderPreferences(styled as unknown as HTMLElement);
  assert.deepEqual(earlyMarks(styled), marksFor(null));
  assert.equal(styled.getAttribute("style"), "--other: 1;");

  // Nothing to remove.
  const clean = createRoot();
  clearEarlyReaderPreferences(clean as unknown as HTMLElement);
  assert.equal(clean.attributes.size, 0);
});

test("globals.css sets every listed typeface on the article, and every stored one before hydration", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const font of READER_FONTS) {
    assert.match(css, new RegExp(`article\\[data-reader-font="${font}"\\][^{]*\\{\\s*font-family:`), font);
    // The default is what the server renders, so it needs no early rule.
    if (font !== DEFAULT_READER_PREFERENCES.font) {
      assert.match(css, new RegExp(`html\\[data-reader-early-font="${font}"\\] article\\[data-reader-font\\]`), font);
    }
  }
  // The chapter text is the only text that takes a typeface from these rules.
  assert.doesNotMatch(css, /\[data-reader-font[^\]]*\]\s+(h1|header|nav|button)/);
});

test("globals.css sets each spacing's line height on the article, and every stored one before hydration", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const lineSpacing of READER_LINE_SPACINGS) {
    const lineHeight = String(READER_LINE_HEIGHTS[lineSpacing]).replace(".", "\\.");
    assert.match(
      css,
      new RegExp(`article\\[data-reader-line-spacing="${lineSpacing}"\\][^{]*\\{\\s*line-height:\\s*${lineHeight};`),
      lineSpacing,
    );
    // The default is what the server renders, so it needs no early rule.
    const early = new RegExp(
      `html\\[data-reader-early-line-spacing="${lineSpacing}"\\] article\\[data-reader-line-spacing\\][^{]*\\{\\s*line-height:\\s*${lineHeight};`,
    );
    if (lineSpacing === DEFAULT_READER_PREFERENCES.lineSpacing) assert.doesNotMatch(css, early, lineSpacing);
    else assert.match(css, early, lineSpacing);
  }
  // The paragraphs inherit the article's line height instead of fixing their own.
  const chapterPage = readFileSync(new URL("../app/[locale]/books/[slug]/[chapter]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chapterPage, /<p key=\{index\}[^>]*leading-/);
});

test("each width has its own side margin, medium the reader's original one, with the measures unchanged", () => {
  assert.deepEqual(READER_SIDE_MARGINS, { narrow: 2, medium: 1.5, wide: 0.75 });
  // 32, 24 and 12px at the default root size: narrower margins leave a wider column.
  assert.ok(READER_SIDE_MARGINS.narrow > READER_SIDE_MARGINS.medium);
  assert.ok(READER_SIDE_MARGINS.medium > READER_SIDE_MARGINS.wide);
  assert.deepEqual(READER_MEASURES, { narrow: 29, medium: 32.5, wide: 36.5 });
  assert.deepEqual(Object.keys(READER_SIDE_MARGINS), Object.keys(READER_MEASURES));
});

test("globals.css sets each width's side margin on the reader's main, and every stored one before hydration", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const [width, margin] of Object.entries(READER_SIDE_MARGINS)) {
    const value = `${String(margin).replace(".", "\\.")}rem`;
    assert.match(
      css,
      new RegExp(`main\\[data-reader-width="${width}"\\][^{]*\\{\\s*padding-inline:\\s*${value};`),
      width,
    );
    // The default is what the server renders, so it needs no early rule.
    const early = new RegExp(
      `html\\[data-reader-early-width="${width}"\\] main\\[data-reader-width\\][^{]*\\{\\s*padding-inline:\\s*${value};`,
    );
    if (width === DEFAULT_READER_PREFERENCES.width) assert.doesNotMatch(css, early, width);
    else assert.match(css, early, width);
  }
  // The reader's main takes its side margin from these rules, not from a fixed utility.
  const reader = readFileSync(new URL("../components/reader/ReaderView.tsx", import.meta.url), "utf8");
  assert.match(reader, /<main id="main-content" data-reader-width=\{width\}/);
  assert.doesNotMatch(reader, /<main id="main-content"[^>]*\bpx-\d/);
});

test("stored widths are restored and an unsupported one falls back to medium, keeping the other preferences", () => {
  for (const width of ["narrow", "medium", "wide"] as const) {
    assert.equal(
      parseReaderPreferences(
        JSON.stringify({ theme: "dark", width, fontSize: 22, font: "lexend", lineSpacing: "relaxed" }),
      ).width,
      width,
    );
  }
  for (const width of ["Wide", "full", "", null, 1, ["wide"], { value: "narrow" }]) {
    assert.deepEqual(
      parseReaderPreferences(
        JSON.stringify({ theme: "dark", width, fontSize: 22, font: "lexend", lineSpacing: "relaxed" }),
      ),
      { theme: "dark", width: "medium", fontSize: 22, font: "lexend", lineSpacing: "relaxed" },
      JSON.stringify(width),
    );
  }
});
