import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createNextChapterPrefetcher,
  NEXT_CHAPTER_PREFETCH_PROGRESS,
  readNetworkConditions,
  shouldPrefetchNextChapter,
  type NextChapterPrefetchState,
} from "./next-chapter-prefetch";

const nextHref = "/es/books/dracula/chapter-2?edition=7b1f1d2c-3d4e-4f50-8a6b-7c8d9e0f1a2b";

const nearTheEnd: NextChapterPrefetchState = {
  nextHref,
  progress: 0,
  footerNear: true,
  online: true,
  saveData: false,
  effectiveType: "4g",
};

test("the next chapter is prefetched near the end of a chapter: footer close or progress past the threshold", () => {
  assert.equal(shouldPrefetchNextChapter({ ...nearTheEnd, prefetchedHref: null }), true);
  assert.equal(
    shouldPrefetchNextChapter({
      ...nearTheEnd,
      footerNear: false,
      progress: NEXT_CHAPTER_PREFETCH_PROGRESS,
      prefetchedHref: null,
    }),
    true,
  );
  assert.equal(
    shouldPrefetchNextChapter({
      ...nearTheEnd,
      footerNear: false,
      progress: NEXT_CHAPTER_PREFETCH_PROGRESS - 1,
      prefetchedHref: null,
    }),
    false,
  );
});

test("nothing is prefetched without a next chapter, offline, with data saver or on a 2g connection", () => {
  for (const state of [
    { nextHref: undefined },
    { nextHref: "" },
    { online: false },
    { saveData: true },
    { effectiveType: "2g" },
    { effectiveType: "slow-2g" },
  ]) {
    assert.equal(shouldPrefetchNextChapter({ ...nearTheEnd, ...state, prefetchedHref: null }), false, String(state));
  }

  // Where the Network Information API is missing (Safari, Firefox), only the online state decides.
  assert.equal(shouldPrefetchNextChapter({ ...nearTheEnd, effectiveType: undefined, prefetchedHref: null }), true);
  assert.equal(shouldPrefetchNextChapter({ ...nearTheEnd, effectiveType: "3g", prefetchedHref: null }), true);
});

test("a URL already prefetched is not prefetched again, a different one is", () => {
  assert.equal(shouldPrefetchNextChapter({ ...nearTheEnd, prefetchedHref: nextHref }), false);
  assert.equal(shouldPrefetchNextChapter({ ...nearTheEnd, prefetchedHref: "/en/books/dracula/chapter-2" }), true);
});

test("network conditions are read from navigator, with the Network Information API optional", () => {
  assert.deepEqual(readNetworkConditions({ onLine: true }), {
    online: true,
    saveData: false,
    effectiveType: undefined,
  });
  assert.deepEqual(readNetworkConditions({ onLine: false, connection: { saveData: true, effectiveType: "slow-2g" } }), {
    online: false,
    saveData: true,
    effectiveType: "slow-2g",
  });
});

function spy() {
  const invalidations: (() => void)[] = [];
  const prefetch = (onInvalidate: () => void) => {
    invalidations.push(onInvalidate);
  };
  return { invalidations, prefetch };
}

test("a chapter prefetches its next chapter once, however many scroll, footer and network events follow", () => {
  const prefetcher = createNextChapterPrefetcher();
  const { invalidations, prefetch } = spy();

  assert.equal(prefetcher.update({ ...nearTheEnd, footerNear: false, progress: 10 }, prefetch), false);
  assert.equal(prefetcher.update(nearTheEnd, prefetch), true);
  for (let progress = 76; progress <= 100; progress++) prefetcher.update({ ...nearTheEnd, progress }, prefetch);
  prefetcher.update({ ...nearTheEnd, footerNear: false }, prefetch);

  assert.equal(invalidations.length, 1);
});

test("a change of language or edition prefetches the new URL", () => {
  const prefetcher = createNextChapterPrefetcher();
  const { invalidations, prefetch } = spy();

  prefetcher.update(nearTheEnd, prefetch);
  prefetcher.update({ ...nearTheEnd, nextHref: nextHref.replace("/es/", "/en/") }, prefetch);
  prefetcher.update({ ...nearTheEnd, nextHref: "/es/books/dracula/chapter-2?edition=other" }, prefetch);

  assert.equal(invalidations.length, 3);
});

test("a prefetch blocked by the network starts once the conditions allow it", () => {
  const prefetcher = createNextChapterPrefetcher();
  const { invalidations, prefetch } = spy();

  prefetcher.update({ ...nearTheEnd, online: false }, prefetch);
  prefetcher.update({ ...nearTheEnd, saveData: true }, prefetch);
  assert.equal(invalidations.length, 0);

  prefetcher.update(nearTheEnd, prefetch);
  assert.equal(invalidations.length, 1);
});

test("an invalidated prefetch is refreshed once, never in a loop", () => {
  const prefetcher = createNextChapterPrefetcher();
  const { invalidations, prefetch } = spy();

  prefetcher.update(nearTheEnd, prefetch);
  invalidations[0]();
  assert.equal(invalidations.length, 2);

  invalidations[1]();
  invalidations[0]();
  prefetcher.update(nearTheEnd, prefetch);
  assert.equal(invalidations.length, 2);
});

test("an invalidation refreshes only under the current conditions, and not after the chapter is released", () => {
  const offline = createNextChapterPrefetcher();
  const first = spy();
  offline.update(nearTheEnd, first.prefetch);
  offline.update({ ...nearTheEnd, online: false }, first.prefetch);
  first.invalidations[0]();
  assert.equal(first.invalidations.length, 1);

  const released = createNextChapterPrefetcher();
  const second = spy();
  released.update(nearTheEnd, second.prefetch);
  released.release();
  second.invalidations[0]();
  assert.equal(second.invalidations.length, 1);
});

test("a prefetch that throws is not retried and does not break the reader", () => {
  const prefetcher = createNextChapterPrefetcher();
  let calls = 0;
  const failing = () => {
    calls += 1;
    throw new Error("router not ready");
  };

  assert.doesNotThrow(() => prefetcher.update(nearTheEnd, failing));
  prefetcher.update({ ...nearTheEnd, progress: 100 }, failing);

  assert.equal(calls, 1);
});
