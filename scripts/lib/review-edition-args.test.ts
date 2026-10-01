import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEditionReviewArguments } from "./review-edition-args";

test("edition review arguments default to show and accept optional notes", () => {
  assert.deepEqual(parseEditionReviewArguments(["--gutenberg-id", "345"]), {
    sourceName: "Project Gutenberg",
    sourceIdentifier: "345",
    notes: undefined,
    action: "show",
    copyrightStatus: undefined,
  });
  assert.deepEqual(parseEditionReviewArguments(["--gutenberg-id", "345", "--notes", "Checked edition"]), {
    sourceName: "Project Gutenberg",
    sourceIdentifier: "345",
    notes: "Checked edition",
    action: "show",
    copyrightStatus: undefined,
  });
});

test("edition review arguments select each supported action", () => {
  for (const [flag, action] of [
    ["--publish", "publish"],
    ["--reject", "reject"],
    ["--archive", "archive"],
    ["--prefer", "prefer"],
  ] as const) {
    const args = ["--gutenberg-id", "345", flag];
    if (action === "publish") args.push("--copyright-status", "LICENSED");
    assert.equal(parseEditionReviewArguments(args).action, action);
  }
});

test("review can identify an edition from a non-Gutenberg source", () => {
  assert.deepEqual(
    parseEditionReviewArguments(["--source-name", "Library of Congress", "--source-identifier", "123"]),
    {
      sourceName: "Library of Congress",
      sourceIdentifier: "123",
      notes: undefined,
      action: "show",
      copyrightStatus: undefined,
    },
  );
});

test("publishing requires an explicit eligible copyright classification", () => {
  for (const copyrightStatus of ["PUBLIC_DOMAIN_VERIFIED", "LICENSED", "ORIGINAL"] as const) {
    assert.equal(
      parseEditionReviewArguments(["--gutenberg-id", "345", "--publish", "--copyright-status", copyrightStatus])
        .copyrightStatus,
      copyrightStatus,
    );
  }

  for (const args of [
    ["--gutenberg-id", "345", "--publish"],
    ["--gutenberg-id", "345", "--publish", "--copyright-status", "PENDING_REVIEW"],
    ["--gutenberg-id", "345", "--reject", "--copyright-status", "LICENSED"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args));
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
    ["--source-name", "Source only"],
    ["--source-identifier", "Identifier only"],
    ["--gutenberg-id", "345", "--source-name", "Other", "--source-identifier", "1"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args));
  }
});

test("edition review arguments refuse multiple state-changing actions", () => {
  for (const args of [
    ["--gutenberg-id", "345", "--publish", "--copyright-status", "LICENSED", "--reject"],
    ["--gutenberg-id", "345", "--publish", "--archive"],
    ["--gutenberg-id", "345", "--reject", "--archive"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args), /only one action/i);
  }
});
