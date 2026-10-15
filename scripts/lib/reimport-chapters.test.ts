import assert from "node:assert/strict";
import { test } from "node:test";
import { planChapterReimport, remapParagraphIndex, remapReadingPosition } from "./reimport-chapters";

const chapter = (id: string, number: number, title = id, content = `${id} paragraph one\n\n${id} paragraph two`) => ({
  id,
  number,
  slug: id,
  title,
  content,
  wordCount: 10,
});
test("reimport preserves UUIDs and progress references when a prologue shifts chapter numbers", () => {
  const existing = [chapter("one", 1), chapter("two", 2)];
  const plan = planChapterReimport(
    existing,
    [chapter("prologue", 1), chapter("one", 2), chapter("two", 3), chapter("epilogue", 4)],
    new Set(["one", "two"]),
  );
  assert.deepEqual(plan.removedIds, []);
  assert.deepEqual(
    plan.chapters.map((item) => item.existing?.id),
    [undefined, "one", "two", undefined],
  );
});
test("unique unchanged text preserves UUIDs across slug/title changes and repeated headings", () => {
  const existing = [chapter("one", 1, "Repeated"), chapter("two", 2, "Repeated")];
  const plan = planChapterReimport(
    existing,
    [
      { ...existing[1], slug: "new-first", number: 1 },
      { ...existing[0], slug: "new-second", number: 2 },
    ],
    new Set(["one"]),
  );
  assert.deepEqual(
    plan.chapters.map((item) => item.existing?.id),
    ["two", "one"],
  );
});
test("ambiguous or removed referenced chapters abort before any writes, rather than deleting progress", () => {
  const existing = [chapter("one", 1), chapter("two", 2)];
  assert.throws(() => planChapterReimport(existing, [existing[0]], new Set(["two"])), /cannot safely match/);
  const ambiguous = [chapter("one", 1, "Repeated", "Same"), chapter("two", 2, "Repeated", "Same")];
  assert.throws(() => planChapterReimport(ambiguous, ambiguous, new Set(["one"])), /cannot safely match/);
  assert.deepEqual(planChapterReimport(existing, [existing[0]], new Set(["one"])).removedIds, ["two"]);
});
test("duplicate slugs/numbers and empty editions are rejected", () => {
  assert.throws(() => planChapterReimport([], [chapter("one", 1), chapter("one", 2)], new Set()), /Duplicate/);
  assert.throws(() => planChapterReimport([], [chapter("one", 1), chapter("two", 1)], new Set()), /Duplicate/);
  assert.throws(() => planChapterReimport([], [], new Set()), /no chapters/);
});
test("edited chapters retain identity and remap existing paragraph references", () => {
  const before = chapter("one", 1, "One", "First\n\nCurrent\n\nLast");
  const after = { ...before, content: "Added\n\nFirst\n\nCurrent\n\nLast" };
  assert.equal(planChapterReimport([before], [after], new Set(["one"])).chapters[0].existing?.id, "one");
  assert.equal(remapParagraphIndex(before.content, after.content, 1), 2);
  assert.equal(remapParagraphIndex(before.content, "Only paragraph", 200), 0);
});

test("a position keeps its paragraph and gets the share of the text that precedes it as percentage", () => {
  const before = "one two\n\nthree four\n\nfive six";
  const after = `${before}\n\n${"seven ".repeat(6).trim()}\n\n${"eight ".repeat(6).trim()}`;
  // 18 words after, 6 before: start 0 %, second paragraph 2/18 words = 11 %, third = 4/18 = 22 %.
  assert.deepEqual(remapReadingPosition(before, after, { paragraphIndex: 0, percentage: 0 }), {
    paragraphIndex: 0,
    percentage: 0,
  });
  assert.deepEqual(remapReadingPosition(before, after, { paragraphIndex: 1, percentage: 50 }), {
    paragraphIndex: 1,
    percentage: 11,
  });
  // A reader who had finished the shorter text is at its last paragraph of the longer one, no longer at 100 %.
  assert.deepEqual(remapReadingPosition(before, after, { paragraphIndex: 2, percentage: 100 }), {
    paragraphIndex: 2,
    percentage: 22,
  });
});

test("a reader who finished a chapter whose last paragraph is still the last one stays finished", () => {
  const before = "one two\n\nthree four\n\nfive six";
  const after = "zero\n\none two\n\nthree four\n\nfive six";
  assert.deepEqual(remapReadingPosition(before, after, { paragraphIndex: 2, percentage: 100 }), {
    paragraphIndex: 3,
    percentage: 100,
  });
  // The same index in the middle of the text is recomputed.
  assert.equal(remapReadingPosition(before, after, { paragraphIndex: 1, percentage: 60 }).percentage, 43);
});
