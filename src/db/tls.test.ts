import assert from "node:assert/strict";
import { test } from "node:test";

import { drizzleKitCredentials, isLocalDatabase, postgresTls } from "./tls";

// Fictitious on purpose, as in scripts/lib/write-guard.test.ts: hosts under the reserved .invalid TLD and an
// obvious placeholder instead of a password. Connection strings are assembled at run time, so no complete URL
// with credentials sits in the source.
const PLACEHOLDER_PASSWORD = "placeholder-not-a-password";
const REMOTE_HOST = "db-pool-1.example.invalid";

function connectionUrl({
  user = "postgres.exampleprojectref",
  password = PLACEHOLDER_PASSWORD,
  host = REMOTE_HOST,
  port = "5432",
  path = "/postgres",
}: { user?: string; password?: string; host?: string; port?: string; path?: string } = {}) {
  return [
    "postgresql://",
    encodeURIComponent(user),
    ":",
    encodeURIComponent(password),
    "@",
    host,
    ":",
    port,
    path,
  ].join("");
}

const ca = "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----";
const remote = connectionUrl();

test("F-04: a local database keeps each caller's current TLS behavior and needs no CA", () => {
  for (const url of [
    "postgres://dev@localhost:5432/libra",
    "postgres://dev@127.0.0.1:5432/libra",
    "postgres://dev@[::1]:5432/libra",
  ]) {
    assert.equal(postgresTls(url, { local: false, env: {} }), false);
    assert.equal(postgresTls(url, { local: "require", env: {} }), "require");
  }
});

test("F-04: a remote database is verified against the configured CA", () => {
  assert.deepEqual(postgresTls(remote, { local: "require", env: { DATABASE_CA_CERT: ca } }), {
    ca,
    rejectUnauthorized: true,
  });
  // Single-line stores keep the PEM with escaped newlines.
  assert.deepEqual(postgresTls(remote, { local: false, env: { DATABASE_CA_CERT: ca.replace(/\n/g, "\\n") } }), {
    ca,
    rejectUnauthorized: true,
  });
});

test("F-04: a remote database without a CA is refused instead of connecting unverified", () => {
  for (const value of [undefined, "", "   "]) {
    for (const local of [false, "require"] as const) {
      assert.throws(
        () => postgresTls(remote, { local, env: { DATABASE_CA_CERT: value } }),
        (error: Error) =>
          /DATABASE_CA_CERT is required/.test(error.message) &&
          !error.message.includes(REMOTE_HOST) &&
          !error.message.includes(PLACEHOLDER_PASSWORD),
      );
    }
  }
});

test("F-04: a CA value that is not a PEM certificate is rejected", () => {
  for (const value of ["not a certificate", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"]) {
    assert.throws(() => postgresTls(remote, { local: false, env: { DATABASE_CA_CERT: value } }), /PEM certificate/);
  }
});

test("F-04: only this machine counts as local; look-alike, hostless and unparseable targets are remote", () => {
  for (const url of [
    "postgres://dev@localhost.attacker.invalid:5432/libra",
    // "localhost" as the user name, not the host.
    connectionUrl({ user: "localhost", host: REMOTE_HOST }),
    "postgres://dev@db.example.invalid:5432/libra?host=localhost",
    "postgres://dev@/libra?host=/var/run/postgresql",
    "postgres://dev@127.0.0.2:5432/libra",
    "not a url",
    "",
  ]) {
    assert.equal(isLocalDatabase(url), false, url);
    assert.throws(() => postgresTls(url, { local: false, env: {} }), /DATABASE_CA_CERT is required/, url);
  }
});

test("F-04: a remote IP address is passed as the host Node checks, since postgres.js sends no servername for it", () => {
  assert.deepEqual(postgresTls(connectionUrl({ host: "10.1.2.3" }), { local: false, env: { DATABASE_CA_CERT: ca } }), {
    ca,
    rejectUnauthorized: true,
    host: "10.1.2.3",
  });
  assert.deepEqual(
    postgresTls(connectionUrl({ host: "[2001:db8::1]" }), { local: false, env: { DATABASE_CA_CERT: ca } }),
    {
      ca,
      rejectUnauthorized: true,
      host: "2001:db8::1",
    },
  );
});

test("F-04: an unparseable remote URL fails without carrying the URL or its password", () => {
  assert.throws(
    () => postgresTls(connectionUrl({ host: "[not-an-ip" }), { local: false, env: { DATABASE_CA_CERT: ca } }),
    (error: Error & { input?: unknown }) =>
      /not a valid URL/.test(error.message) && !("input" in error) && !error.message.includes(PLACEHOLDER_PASSWORD),
  );
});

test("F-04: drizzle-kit keeps the URL for a local database", () => {
  const url = "postgres://dev@localhost:5432/libra";

  assert.deepEqual(drizzleKitCredentials(url, {}), { url });
});

test("F-04: drizzle-kit gets a remote database field by field, with verifying TLS options", () => {
  // Reserved URL characters in the user name and password must arrive decoded.
  const password = ["placeholder", "@", "/", ":", "%"].join("");
  const url = `${connectionUrl({ password })}?sslmode=require`;

  assert.deepEqual(drizzleKitCredentials(url, { DATABASE_CA_CERT: ca }), {
    host: REMOTE_HOST,
    port: 5432,
    user: "postgres.exampleprojectref",
    password,
    database: "postgres",
    ssl: { ca, rejectUnauthorized: true },
  });
});

test("F-04: drizzle-kit credentials refuse a remote database without a CA, a database name or with lost parameters", () => {
  assert.throws(() => drizzleKitCredentials(remote, {}), /DATABASE_CA_CERT is required/);
  assert.throws(
    () => drizzleKitCredentials(connectionUrl({ path: "/" }), { DATABASE_CA_CERT: ca }),
    /host and a database/,
  );
  assert.throws(
    () =>
      drizzleKitCredentials(connectionUrl({ path: "/libra?options=-c%20search_path%3Dx" }), {
        DATABASE_CA_CERT: ca,
      }),
    /query parameters/,
  );
});
