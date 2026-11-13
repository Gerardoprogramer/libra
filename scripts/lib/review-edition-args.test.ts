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

test("--confirm-database is parsed with its value, in any position, and omitted when absent", () => {
  // The id is only carried here; whether it matches the target database is decided by the write guard.
  assert.deepEqual(
    parseEditionReviewArguments(["--gutenberg-id", "345", "--archive", "--apply", "--confirm-database", "exa..ef"]),
    {
      sourceName: "Project Gutenberg",
      sourceIdentifier: "345",
      notes: undefined,
      action: "archive",
      copyrightStatus: undefined,
      confirmDatabase: "exa..ef",
      apply: true,
    },
  );
  assert.equal(
    parseEditionReviewArguments(["--confirm-database", "exa..ef", "--gutenberg-id", "345", "--reject", "--apply"])
      .confirmDatabase,
    "exa..ef",
  );
  assert.ok(!("confirmDatabase" in parseEditionReviewArguments(["--gutenberg-id", "345", "--archive"])));
});

test("the separator that pnpm forwards is accepted only as the first argument", () => {
  const args = ["--gutenberg-id", "345", "--archive", "--apply", "--confirm-database", "exa..ef"];

  assert.deepEqual(parseEditionReviewArguments(["--", ...args]), parseEditionReviewArguments(args));
  assert.equal(parseEditionReviewArguments(["--", "--gutenberg-id", "345"]).action, "show");
  // Anywhere else it is an unknown argument, and on its own it leaves nothing to review.
  assert.throws(() => parseEditionReviewArguments(["--gutenberg-id", "345", "--", "--archive"]), /Unknown/);
  assert.throws(() => parseEditionReviewArguments(["--"]), /Specify --gutenberg-id/);
});

test("--confirm-database refuses a missing, empty, flag-like or repeated value", () => {
  for (const args of [
    ["--gutenberg-id", "345", "--archive", "--confirm-database"],
    ["--gutenberg-id", "345", "--archive", "--confirm-database", ""],
    ["--gutenberg-id", "345", "--archive", "--confirm-database", "--archive"],
    ["--confirm-database", "--gutenberg-id", "345", "--archive"],
    ["--gutenberg-id", "345", "--archive", "--confirm-database", "exa..ef", "--confirm-database", "exa..ef"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args), /Expected one --confirm-database value/, args.join(" "));
  }
});

test("an action without --apply is a dry run, and --apply is carried only when given", () => {
  const dryRun = parseEditionReviewArguments(["--gutenberg-id", "345", "--publish", "--copyright-status", "LICENSED"]);
  assert.equal(dryRun.action, "publish");
  assert.ok(!("apply" in dryRun));

  for (const flag of ["--publish", "--reject", "--archive", "--prefer"]) {
    const args = ["--gutenberg-id", "345", flag, "--apply"];
    if (flag === "--publish") args.push("--copyright-status", "LICENSED");
    assert.equal(parseEditionReviewArguments(args).apply, true, flag);
  }
});

test("--apply needs an action and is accepted once", () => {
  assert.throws(() => parseEditionReviewArguments(["--gutenberg-id", "345", "--apply"]), /--apply needs an action/);
  assert.throws(
    () => parseEditionReviewArguments(["--gutenberg-id", "345", "--archive", "--apply", "--apply"]),
    /--apply at most once/,
  );
});

test("--confirm-database without --apply is refused, even with a valid id", () => {
  for (const args of [
    ["--gutenberg-id", "345", "--archive", "--confirm-database", "exa..ef"],
    ["--gutenberg-id", "345", "--confirm-database", "exa..ef"],
  ]) {
    assert.throws(() => parseEditionReviewArguments(args), /only used with --apply/, args.join(" "));
  }
});
