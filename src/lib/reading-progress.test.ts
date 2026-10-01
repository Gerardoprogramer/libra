import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  readAllReadingProgress,
  readReadingProgress,
  parseReadingProgress,
  READING_PROGRESS_CHANGE_EVENT,
  READING_PROGRESS_PREFIX,
  saveReadingProgress,
  calculateBookProgress,
  type ReadingProgress,
} from "./reading-progress";

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
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });

  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });

  return { browser, values };
}

function makeProgress(bookSlug: string): ReadingProgress {
  return {
    bookSlug,
    chapterSlug: "chapter-one",
    chapterTitle: "Chapter One",
    chapterNumber: 1,
    chapterIndex: 0,
    totalChapters: 10,
    percentage: 25,
    updatedAt: "2026-09-30T12:00:00.000Z",
  };
}

test("progress storage helpers are safe during SSR", () => {
  Reflect.deleteProperty(globalThis, "window");

  assert.equal(readReadingProgress("dracula"), null);
  assert.equal(readAllReadingProgress(), null);
  assert.equal(saveReadingProgress(makeProgress("dracula")), false);
});

test("malformed, mismatched and out-of-range progress entries are ignored", () => {
  const { values } = createBrowser();
  const progress = makeProgress("dracula");

  values.set(`${READING_PROGRESS_PREFIX}other-book`, JSON.stringify(progress));
  assert.deepEqual(readAllReadingProgress(), []);

  for (const value of [
    null,
    "{",
    JSON.stringify({ ...progress, percentage: 101 }),
    JSON.stringify({ ...progress, percentage: -1 }),
    JSON.stringify({ ...progress, percentage: Number.NaN }),
    JSON.stringify({ ...progress, chapterNumber: 0 }),
    JSON.stringify({ ...progress, chapterNumber: 1.5 }),
    JSON.stringify({ ...progress, chapterIndex: 10 }),
    JSON.stringify({ ...progress, totalChapters: 0 }),
    JSON.stringify({ ...progress, updatedAt: "not-a-date" }),
  ]) {
    assert.equal(parseReadingProgress(value), null);
  }
});

test("zero and complete chapter progress are valid and calculate to their expected book percentages", () => {
  const progress = makeProgress("dracula");

  assert.equal(parseReadingProgress(JSON.stringify({ ...progress, percentage: 0 }))?.percentage, 0);
  assert.equal(parseReadingProgress(JSON.stringify({ ...progress, percentage: 100 }))?.percentage, 100);
  assert.equal(calculateBookProgress({ ...progress, percentage: 0 }), 0);
  assert.equal(calculateBookProgress({ ...progress, percentage: 100 }), 10);
  assert.equal(calculateBookProgress({ ...progress, chapterIndex: 9, totalChapters: 10, percentage: 100 }), 100);
});

test("saved progress is enumerable and notifies same-tab subscribers", () => {
  const { browser, values } = createBrowser();
  const progress = makeProgress("dracula");
  let notifications = 0;

  browser.addEventListener(READING_PROGRESS_CHANGE_EVENT, () => notifications++);

  assert.equal(saveReadingProgress(progress), true);
  assert.equal(readReadingProgress("dracula"), JSON.stringify(progress));
  assert.deepEqual(readAllReadingProgress(), [JSON.stringify(progress)]);
  assert.equal(notifications, 1);
  assert.equal(values.has(`${READING_PROGRESS_PREFIX}dracula`), true);
});

test("empty storage and unrelated or unexpected keys do not create reading progress", () => {
  const { values } = createBrowser();

  assert.deepEqual(readAllReadingProgress(), []);
  values.set("unrelated:key", "not progress");
  values.set(`${READING_PROGRESS_PREFIX}dracula`, "not JSON");
  values.set(`${READING_PROGRESS_PREFIX}frankenstein`, JSON.stringify({ unexpected: true }));

  assert.deepEqual(readAllReadingProgress(), []);
});

test("blocked and quota-limited storage fail without throwing or reporting success", () => {
  const { browser } = createBrowser();
  let notifications = 0;

  browser.addEventListener(READING_PROGRESS_CHANGE_EVENT, () => notifications++);
  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("Storage access denied");
    },
  });

  assert.equal(readReadingProgress("dracula"), null);
  assert.equal(readAllReadingProgress(), null);
  assert.equal(saveReadingProgress(makeProgress("dracula")), false);
  assert.equal(notifications, 0);

  const quotaBrowser = createBrowser();
  quotaBrowser.browser.localStorage.setItem = () => {
    throw new Error("Storage quota exceeded");
  };
  let quotaNotifications = 0;
  quotaBrowser.browser.addEventListener(READING_PROGRESS_CHANGE_EVENT, () => quotaNotifications++);

  assert.equal(saveReadingProgress(makeProgress("frankenstein")), false);
  assert.equal(quotaNotifications, 0);
});
