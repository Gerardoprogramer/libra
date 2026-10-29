import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMediaBase, planCoverOriginMigration } from "./cover-origin-migration";

// Pure planning only: no database, R2 or network access.
const oldBase = parseMediaBase("https://pub-0123.r2.dev", "--from");
const newBase = parseMediaBase("https://covers.example.com/", "--to");

test("bases must be HTTPS without credentials, query or fragment, and lose a trailing slash", () => {
  assert.equal(newBase.href, "https://covers.example.com");
  assert.equal(parseMediaBase("https://cdn.example.com/books/", "--to").href, "https://cdn.example.com/books");
  for (const value of [
    "http://covers.example.com",
    "https://user:pass@covers.example.com",
    "https://covers.example.com/?a=1",
    "https://covers.example.com/#x",
    "not a url",
  ]) {
    assert.throws(() => parseMediaBase(value, "--to"), /--to must/, value);
  }
  assert.throws(() => parseMediaBase(undefined, "--from"), /--from is required/);
});

test("only covers under the old base move, keeping their object key", () => {
  const plan = planCoverOriginMigration(
    [
      { id: "a", coverUrl: "https://pub-0123.r2.dev/covers/dracula-345-2c05b012cd42.jpg" },
      { id: "b", coverUrl: "https://covers.example.com/covers/miau-52392-cb833d2a269f.jpg" },
      { id: "c", coverUrl: null },
      { id: "d", coverUrl: "https://elsewhere.example/covers/x.jpg" },
      // A host that merely starts like the old one is not under it.
      { id: "e", coverUrl: "https://pub-0123.r2.dev.evil.example/covers/x.jpg" },
    ],
    oldBase,
    newBase,
  );

  assert.deepEqual(plan.changes, [
    {
      id: "a",
      from: "https://pub-0123.r2.dev/covers/dracula-345-2c05b012cd42.jpg",
      to: "https://covers.example.com/covers/dracula-345-2c05b012cd42.jpg",
    },
  ]);
  assert.equal(plan.alreadyMigrated, 1);
  assert.equal(plan.withoutCover, 1);
  assert.deepEqual(
    plan.elsewhere.map((row) => row.id),
    ["d", "e"],
  );
});

test("a second run changes nothing, and swapping the bases undoes the first", () => {
  const rows = [
    { id: "a", coverUrl: "https://pub-0123.r2.dev/covers/a-1-aaaaaaaaaaaa.jpg" },
    { id: "b", coverUrl: "https://pub-0123.r2.dev/covers/b-2-bbbbbbbbbbbb.png" },
  ];
  const first = planCoverOriginMigration(rows, oldBase, newBase);
  const migrated = rows.map((row) => ({ ...row, coverUrl: first.changes.find((c) => c.id === row.id)!.to }));

  const again = planCoverOriginMigration(migrated, oldBase, newBase);
  assert.equal(again.changes.length, 0);
  assert.equal(again.alreadyMigrated, 2);

  const back = planCoverOriginMigration(migrated, newBase, oldBase);
  assert.deepEqual(
    back.changes.map((change) => change.to),
    rows.map((row) => row.coverUrl),
  );
});

test("identical or nested bases are refused", () => {
  assert.throws(() => planCoverOriginMigration([], oldBase, oldBase), /same base/);
  const nested = parseMediaBase("https://pub-0123.r2.dev/covers", "--to");
  assert.throws(() => planCoverOriginMigration([], oldBase, nested), /contain one another/);
  assert.throws(() => planCoverOriginMigration([], nested, oldBase), /contain one another/);
});
