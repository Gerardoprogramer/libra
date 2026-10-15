import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGutenbergArguments } from "./import-arguments";
import { describeDatabaseTarget } from "./import-plan";

const required = [
  "--file",
  "imports/dracula.epub",
  "--gutenberg-id",
  "345",
  "--original-title",
  "Dracula",
  "--original-language",
  "en",
];

test("L10: the single-book CLI defaults to a dry run with no gate open", () => {
  const { options } = parseGutenbergArguments(required);

  assert.equal(options?.apply, false);
  assert.equal(options?.epubOnly, false);
  assert.equal(options?.revisePublished, false);
  assert.equal(options?.allowRemovals, false);
  assert.equal(options?.acceptWarnings, false);
  assert.equal(options?.slug, undefined);
});

test("the pnpm separator and every gate flag are accepted", () => {
  const { options } = parseGutenbergArguments([
    "--",
    ...required,
    "--slug",
    "dracula",
    "--year",
    "1897",
    "--edition-year",
    "1920",
    "--apply",
    "--confirm-database",
    "abc..yz",
    "--revise-published",
    "--plan-hash",
    "0123456789abcdef0123",
    "--allow-removals",
    "--allow-slug-changes",
    "--accept-warnings",
  ]);

  assert.deepEqual(options, {
    file: "imports/dracula.epub",
    gutenbergId: "345",
    slug: "dracula",
    originalTitle: "Dracula",
    originalLanguage: "en",
    year: 1897,
    editionPublicationYear: 1920,
    apply: true,
    epubOnly: false,
    confirmDatabase: "abc..yz",
    revisePublished: true,
    planHash: "0123456789abcdef0123",
    allowRemovals: true,
    allowSlugChanges: true,
    acceptWarnings: true,
  });
});

test("L10: invalid slugs, ids, languages, years and contradictory flags are rejected before any work", () => {
  const withArgs = (...extra: string[]) => [...required, ...extra];

  for (const slug of ["Bad Slug", "bad--slug", "-lead", "../x", "", "a".repeat(252)]) {
    assert.throws(() => parseGutenbergArguments(withArgs("--slug", slug)), /--slug/);
  }
  for (const id of ["abc", "0", "-3", "1.5", "12345678901"]) {
    assert.throws(
      () =>
        parseGutenbergArguments([
          "--file",
          "a.epub",
          "--gutenberg-id",
          id,
          "--original-title",
          "T",
          "--original-language",
          "en",
        ]),
      /gutenberg-id/,
    );
  }
  assert.throws(
    () =>
      parseGutenbergArguments([
        "--file",
        "a.epub",
        "--gutenberg-id",
        "1",
        "--original-title",
        "T",
        "--original-language",
        "english!",
      ]),
    /original-language/,
  );
  for (const year of ["18x7", "1.5", "99999999999"]) {
    assert.throws(() => parseGutenbergArguments(withArgs("--year", year)), /--year/);
  }
  assert.throws(() => parseGutenbergArguments(withArgs("--apply", "--epub-only")), /cannot be combined/);
  assert.throws(
    () => parseGutenbergArguments(withArgs("--plan-hash", "0123456789abcdef0123")),
    /only applies together/,
  );
  assert.throws(() => parseGutenbergArguments(withArgs("--revise-published", "--plan-hash", "short")), /20-character/);
  assert.throws(() => parseGutenbergArguments(withArgs("--aply")));
  assert.throws(() => parseGutenbergArguments(["--file", "a.epub"]), /Missing --/);
  assert.deepEqual(parseGutenbergArguments(["--help"]), { help: true });
});

test("the database target is described without revealing the password, the project or the full host", () => {
  const target = describeDatabaseTarget(
    "postgresql://postgres.abcdefghijklmnop:s3cr3t%2Fpass@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  );

  assert.equal(target.role, "postgres");
  assert.equal(target.isLocal, false);
  assert.equal(target.token, "abc..op");
  assert.equal(target.host, "aws..-1.pooler.supabase.com");
  for (const secret of ["s3cr3t", "abcdefghijklmnop", "aws-0-us-east-1"]) {
    assert.ok(!JSON.stringify(target).includes(secret), `${secret} must not appear`);
  }
});

test("a local database has its own token, and a malformed URL is rejected without echoing it", () => {
  assert.equal(describeDatabaseTarget("postgres://dev:pw@localhost:5432/libra").token, "local");
  assert.equal(describeDatabaseTarget("postgres://dev:pw@localhost:5432/libra").isLocal, true);
  assert.throws(
    () => describeDatabaseTarget("not a url with password hunter2"),
    (error: Error) => !error.message.includes("hunter2"),
  );
});
