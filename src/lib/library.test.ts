import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  LIBRARY_CHANGE_EVENT,
  LIBRARY_STORAGE_KEY,
  addBookToLibrary,
  isBookInLibrary,
  parseLibrary,
  readLibrary,
  readLibrarySnapshot,
  removeBookFromLibrary,
  toggleBookInLibrary,
} from "./library";

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

test("invalid JSON and malformed entries do not break the library", () => {
  for (const value of [null, "", "__server__", "{", "null", "{}", "42"]) {
    assert.deepEqual(parseLibrary(value), []);
  }

  assert.deepEqual(
    parseLibrary(
      JSON.stringify([
        null,
        {},
        { bookSlug: "", addedAt: "2026-09-30T12:00:00Z" },
        { bookSlug: "dracula", addedAt: "invalid" },
        { bookSlug: 42, addedAt: "2026-09-30T12:00:00Z" },
        { bookSlug: "dracula", addedAt: "2026-09-30T12:00:00Z", extra: "discard" },
      ]),
    ),
    [{ bookSlug: "dracula", addedAt: "2026-09-30T12:00:00.000Z" }],
  );
});

test("entries are deduplicated, normalized to ISO and ordered by the latest save", () => {
  assert.deepEqual(
    parseLibrary(
      JSON.stringify([
        { bookSlug: "dracula", addedAt: "2026-09-28T12:00:00Z" },
        { bookSlug: "frankenstein", addedAt: "2026-09-29T12:00:00Z" },
        { bookSlug: " dracula ", addedAt: "2026-09-30T08:00:00-06:00" },
      ]),
    ),
    [
      { bookSlug: "dracula", addedAt: "2026-09-30T14:00:00.000Z" },
      { bookSlug: "frankenstein", addedAt: "2026-09-29T12:00:00.000Z" },
    ],
  );
});

test("all public helpers are safe without a browser during SSR", () => {
  Reflect.deleteProperty(globalThis, "window");
  assert.equal(readLibrarySnapshot(), null);
  assert.deepEqual(readLibrary(), []);
  assert.equal(isBookInLibrary("dracula"), false);
  assert.equal(addBookToLibrary("dracula"), false);
  assert.equal(removeBookFromLibrary("dracula"), false);
  assert.equal(toggleBookInLibrary("dracula"), null);
});

test("writes notify the same tab after persisting, keep other keys and avoid duplicate saves", () => {
  const { browser, values } = createBrowser();
  const snapshots: string[] = [];
  values.set("libra:progress:dracula", "existing progress");
  browser.addEventListener(LIBRARY_CHANGE_EVENT, () => snapshots.push(readLibrarySnapshot()!));

  assert.equal(readLibrarySnapshot(), "[]");
  assert.equal(addBookToLibrary("dracula"), true);
  const saved = readLibrary();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].addedAt, new Date(saved[0].addedAt).toISOString());
  assert.equal(isBookInLibrary("dracula"), true);
  assert.equal(addBookToLibrary("dracula"), true);
  assert.deepEqual(readLibrary(), saved);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0], readLibrarySnapshot());
  assert.equal(toggleBookInLibrary("dracula"), false);
  assert.deepEqual(readLibrary(), []);
  assert.equal(toggleBookInLibrary("dracula"), true);
  assert.equal(removeBookFromLibrary("dracula"), true);
  assert.equal(snapshots.length, 4);
  assert.equal(values.get("libra:progress:dracula"), "existing progress");
  assert.deepEqual([...values.keys()], ["libra:progress:dracula", LIBRARY_STORAGE_KEY]);
});

test("corrupt storage recovers on a save and blank slugs are rejected", () => {
  const { values } = createBrowser();
  values.set(LIBRARY_STORAGE_KEY, "broken JSON");
  assert.equal(addBookToLibrary(" "), false);
  assert.equal(addBookToLibrary("dracula"), true);
  assert.deepEqual(
    readLibrary().map((entry) => entry.bookSlug),
    ["dracula"],
  );
});

test("blocked storage is distinct from an empty library and does not throw", () => {
  const { browser } = createBrowser();
  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("Storage access denied");
    },
  });
  assert.equal(readLibrarySnapshot(), null);
  assert.deepEqual(readLibrary(), []);
  assert.equal(addBookToLibrary("dracula"), false);
  assert.equal(removeBookFromLibrary("dracula"), false);
  assert.equal(toggleBookInLibrary("dracula"), null);
});

test("quota failures preserve saved data and never emit a successful change", () => {
  const { browser } = createBrowser();
  addBookToLibrary("dracula");
  const saved = readLibrarySnapshot();
  let notifications = 0;
  browser.addEventListener(LIBRARY_CHANGE_EVENT, () => notifications++);
  browser.localStorage.setItem = () => {
    throw new Error("Storage quota exceeded");
  };
  assert.equal(addBookToLibrary("frankenstein"), false);
  assert.equal(removeBookFromLibrary("dracula"), false);
  assert.equal(toggleBookInLibrary("dracula"), null);
  assert.equal(readLibrarySnapshot(), saved);
  assert.equal(notifications, 0);
});
