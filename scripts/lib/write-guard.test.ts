import assert from "node:assert/strict";
import { test } from "node:test";

import { findPublicationProblems } from "./review-edition-checks";
import { isMissingRelation } from "./import-errors";
import { assertWriteAllowed, readConfirmedDatabase, sslFor } from "./write-guard";

// Fictitious on purpose: a host under the reserved .invalid TLD and an obviously fake password, assembled from
// parts so that no complete connection string sits in the source.
const remote = [
  "postgresql://postgres.exampleprojectref",
  ":not-a-real-password",
  "@db-pool-1.example.invalid:5432/postgres",
].join("");
// What the guard shows of that project: the first three and last two characters.
const remoteToken = "exa..ef";

test("L18: a remote database is refused until its id is repeated with --confirm-database", () => {
  assert.throws(
    () => assertWriteAllowed({ connectionString: remote, args: [], script: "db:seed:categories", allowRemote: true }),
    /--confirm-database exa\.\.ef/,
  );
  assert.throws(
    () =>
      assertWriteAllowed({
        connectionString: remote,
        args: ["--confirm-database", "other"],
        script: "x",
        allowRemote: true,
      }),
    /--confirm-database exa\.\.ef/,
  );
  assert.equal(
    assertWriteAllowed({
      connectionString: remote,
      args: ["--confirm-database", remoteToken],
      script: "x",
      allowRemote: true,
    }).role,
    "postgres",
  );
});

test("L18: the development seed never writes to a remote database, whatever flags are passed", () => {
  assert.throws(
    () =>
      assertWriteAllowed({
        connectionString: remote,
        args: ["--confirm-database", remoteToken],
        script: "db:seed",
        allowRemote: false,
      }),
    /db:seed never writes to a remote database/,
  );
  assert.equal(
    assertWriteAllowed({
      connectionString: "postgres://dev:pw@localhost:5432/libra",
      args: [],
      script: "db:seed",
      allowRemote: false,
    }).isLocal,
    true,
  );
});

test("the guard messages never contain the password or the full project id", () => {
  try {
    assertWriteAllowed({ connectionString: remote, args: [], script: "x", allowRemote: true });
    assert.fail("expected a refusal");
  } catch (error) {
    const message = (error as Error).message;
    assert.ok(
      !message.includes("not-a-real") && !message.includes("exampleprojectref") && !message.includes("db-pool-1"),
    );
  }
});

test("--confirm-database is read only when it has a value", () => {
  assert.equal(readConfirmedDatabase(["--publish", "--confirm-database", remoteToken]), remoteToken);
  assert.equal(readConfirmedDatabase(["--confirm-database", "--publish"]), undefined);
  assert.equal(readConfirmedDatabase([]), undefined);
});

test("REVIEW: TLS is required for remote databases only, so the local seed can actually connect", () => {
  const ca = "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----";

  assert.deepEqual(sslFor(remote, { DATABASE_CA_CERT: ca }), { ca, rejectUnauthorized: true });
  assert.equal(sslFor("postgres://dev:pw@localhost:5432/libra", {}), false);
  assert.equal(sslFor("postgres://dev:pw@127.0.0.1:5432/libra", {}), false);
});

test("F-04: a remote database without DATABASE_CA_CERT is refused before any connection, never left unverified", () => {
  assert.throws(() => sslFor(remote, {}), /DATABASE_CA_CERT is required/);
});

test("REVIEW: a missing edition_reviews table is recognized through wrapped driver errors", () => {
  const driver = Object.assign(new Error('relation "edition_reviews" does not exist'), { code: "42P01" });
  const wrapped = new Error("Failed query: insert into ...", { cause: driver });

  assert.equal(isMissingRelation(wrapped, "edition_reviews"), true);
  assert.equal(isMissingRelation(wrapped, "editions"), false);
  assert.equal(isMissingRelation(new Error('relation "edition_reviews" does not exist'), "edition_reviews"), false);
  assert.equal(isMissingRelation("boom", "edition_reviews"), false);
});

const ready = {
  title: "Dracula",
  language: "en",
  chapterCount: 27,
  emptyChapterCount: 0,
  wordCount: 160_000,
  authorCount: 1,
  notes: "Bram Stoker died in 1912; public domain in Costa Rica (life + 70).",
};

test("L09: a complete edition with recorded grounds can be published", () => {
  assert.deepEqual(findPublicationProblems(ready), []);
});

test("L09: publishing is refused for empty, textless or authorless editions and for missing grounds", () => {
  assert.match(findPublicationProblems({ ...ready, chapterCount: 0, wordCount: 0 }).join("\n"), /no chapters/);
  assert.match(findPublicationProblems({ ...ready, emptyChapterCount: 2 }).join("\n"), /2 chapter\(s\) have no text/);
  assert.match(findPublicationProblems({ ...ready, wordCount: 0 }).join("\n"), /no readable text/);
  assert.match(findPublicationProblems({ ...ready, authorCount: 0 }).join("\n"), /no author/);
  assert.match(findPublicationProblems({ ...ready, notes: undefined }).join("\n"), /--notes must record the grounds/);
  assert.match(findPublicationProblems({ ...ready, notes: "ok" }).join("\n"), /--notes must record the grounds/);
  assert.match(
    findPublicationProblems({ ...ready, title: " ", language: "" }).join("\n"),
    /no title[\s\S]*no language/,
  );
});
