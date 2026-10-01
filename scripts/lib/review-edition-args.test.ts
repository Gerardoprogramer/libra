import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEditionReviewArguments } from "./review-edition-args";

test("edition review arguments default to show and accept optional notes", () => {
  assert.deepEqual(parseEditionReviewArguments(["--gutenberg-id", "345"]), {
    gutenbergId: "345",
    notes: undefined,
    action: "show",
  });
  assert.deepEqual(parseEditionReviewArguments(["--gutenberg-id", "345", "--notes", "Checked edition"]), {
    gutenbergId: "345",
    notes: "Checked edition",
    action: "show",
  });
});

test("edition review arguments select each supported action", () => {
  for (const [flag, action] of [
    ["--publish", "publish"],
    ["--reject", "reject"],
    ["--archive", "archive"],
  ] as const) {
    assert.equal(parseEditionReviewArguments(["--gutenberg-id", "345", flag]).action, action);
  }
});

test("edition review arguments reject missing values, unknown flags, and duplicate values", () => {
  for (const args of [
    [],
    ["--gutenberg-id"],
    ["--gutenberg-id", "--publish", "--publish"],
    ["--gutenberg-id", "345", "--notes"],
    ["--gutenberg-id", "345", "--unknown"],
    ["--gutenberg-id", "345", "--notes", "first", "--notes", "second"],
    ["--gutenberg-id", "345", "--notes", "", "--notes", "second"],
    ["--gutenberg-id", "345", "--gutenberg-id", "84"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args));
  }
});

test("edition review arguments refuse multiple state-changing actions", () => {
  for (const args of [
    ["--gutenberg-id", "345", "--publish", "--reject"],
    ["--gutenberg-id", "345", "--publish", "--archive"],
    ["--gutenberg-id", "345", "--reject", "--archive"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args), /only one action/i);
  }
});
