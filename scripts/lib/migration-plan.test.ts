import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { describePendingMigrations, pendingMigrations, readJournal } from "./migration-plan";
import { parseApplyArguments } from "./write-guard";

const drizzleFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const entries = [
  { tag: "0000_a", when: 100 },
  { tag: "0001_b", when: 200 },
  { tag: "0002_c", when: 300 },
];

test("pending migrations follow the migrator's rule: newer than the last recorded one, or all", () => {
  assert.deepEqual(pendingMigrations(entries, null), entries);
  assert.deepEqual(pendingMigrations(entries, 200), [{ tag: "0002_c", when: 300 }]);
  assert.deepEqual(pendingMigrations(entries, 300), []);
  // The migrator compares with `<`: an entry recorded with the same timestamp is applied.
  assert.deepEqual(pendingMigrations(entries, 299), [{ tag: "0002_c", when: 300 }]);
});

test("the repository journal lists every migration file in drizzle/, in order", () => {
  const journal = readJournal(drizzleFolder);
  const files = fs
    .readdirSync(drizzleFolder)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -".sql".length))
    .sort();

  assert.deepEqual(
    journal.map((entry) => entry.tag),
    files,
  );
  for (let index = 1; index < journal.length; index++) {
    assert.ok(journal[index].when > journal[index - 1].when, journal[index].tag);
  }
});

test("a journal without valid entries is refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "libra-journal-"));
  try {
    fs.mkdirSync(path.join(dir, "meta"));
    for (const journal of [{}, { entries: [{ tag: "x" }] }, { entries: [{ tag: "", when: 1 }] }]) {
      fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
      assert.throws(() => readJournal(dir), /_journal\.json/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the dry run lists the pending migrations in order, or says there are none", () => {
  assert.deepEqual(describePendingMigrations(entries.slice(1)), [
    "Pending migrations (2), in order:",
    "  0001_b",
    "  0002_c",
  ]);
  assert.match(describePendingMigrations([])[0], /^No pending migrations/);
});

test("db:migrate is a dry run unless --apply is given, and refuses --confirm-database without it", () => {
  assert.deepEqual(parseApplyArguments([], "db:migrate"), { apply: false });
  assert.deepEqual(parseApplyArguments(["--", "--apply", "--confirm-database", "exa..ef"], "db:migrate"), {
    apply: true,
  });
  assert.throws(() => parseApplyArguments(["--confirm-database", "exa..ef"], "db:migrate"), /only used with --apply/);
  assert.throws(() => parseApplyArguments(["--force"], "db:migrate"), /Unknown db:migrate argument: --force/);
});
