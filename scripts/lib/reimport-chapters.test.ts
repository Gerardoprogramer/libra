import assert from "node:assert/strict";
import { test } from "node:test";
import { planChapterReimport, remapParagraphIndex } from "./reimport-chapters";

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
