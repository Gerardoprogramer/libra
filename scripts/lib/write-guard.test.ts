import assert from "node:assert/strict";
import { test } from "node:test";

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
  assert.equal(sslFor(remote), "require");
  assert.equal(sslFor("postgres://dev:pw@localhost:5432/libra"), false);
  assert.equal(sslFor("postgres://dev:pw@127.0.0.1:5432/libra"), false);
});
