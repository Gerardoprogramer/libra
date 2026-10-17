import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { TLSSocket } from "node:tls";

import postgres from "postgres";

import { drizzleKitCredentials, postgresTls } from "./tls";

// Real postgres.js against a stand-in server that speaks just enough of the protocol: it accepts the SSLRequest,
// upgrades to TLS with a test certificate, and answers the startup message with an error carrying a marker. Seeing
// the marker means the TLS handshake was accepted; a TLS error means the client refused the certificate. Every key
// and certificate is generated for this run and deleted afterwards.

const HANDSHAKE_ACCEPTED = "libra-test: TLS handshake accepted";
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const dir = mkdtempSync(join(tmpdir(), "libra-tls-"));

function openssl(...args: string[]) {
  const result = spawnSync("openssl", args, { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function makeCa(name: string) {
  openssl(
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", `${name}.key`, "-out", `${name}.crt`, "-subj", `/CN=Libra test ${name}`,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign",
  ); // prettier-ignore
}

// `altName` is a subjectAltName entry, such as "DNS:localhost" or "IP:127.0.0.2".
function makeServerCert(name: string, ca: string, altName: string) {
  const dnsName = altName.replace(/^(DNS|IP):/, "");
  writeFileSync(
    join(dir, `${name}.ext`),
    `subjectAltName=${altName}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`,
  );
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=${dnsName}`,
  );
  openssl(
    "x509", "-req", "-in", `${name}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`, "-set_serial", "1",
    "-days", "1", "-out", `${name}.crt`, "-extfile", `${name}.ext`,
  ); // prettier-ignore
}

const read = (file: string) => readFileSync(join(dir, file), "utf8");

function errorResponse(message: string) {
  const fields = Buffer.from(`SFATAL\0C28000\0M${message}\0\0`);
  const header = Buffer.alloc(5);
  header.write("E", 0);
  header.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([header, fields]);
}

const servers: Server[] = [];

async function startServer(certName: string, host = "localhost"): Promise<number> {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", () => {
      // The 8-byte SSLRequest: agree, then switch to TLS.
      socket.write("S");
      const secure = new TLSSocket(socket, {
        isServer: true,
        key: read(`${certName}.key`),
        cert: read(`${certName}.crt`),
      });
      secure.on("error", () => {});
      secure.once("data", () => secure.end(errorResponse(HANDSHAKE_ACCEPTED)));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

async function connect(port: number, ssl: ReturnType<typeof postgresTls>): Promise<Error & { code?: string }> {
  return query(
    postgres({ host: "localhost", port, user: "libra", database: "libra", ssl, max: 1, connect_timeout: 5 }),
  );
}

async function query(sql: postgres.Sql): Promise<Error & { code?: string }> {
  try {
    await sql`select 1`;
    throw new Error("the stand-in server never completes a query");
  } catch (error) {
    return error as Error & { code?: string };
  } finally {
    await sql.end({ timeout: 0 });
  }
}

// postgresTls only returns a verifying object for a remote URL; its result is then used against the stand-in.
const verifiedWith = (caFile: string) =>
  postgresTls("postgres://libra@db.example.com:5432/libra", { local: false, env: { DATABASE_CA_CERT: read(caFile) } });

let trustedPort = 0;
let otherNamePort = 0;
// 127.0.0.2 is a loopback address the helper treats as remote. Not every system routes it (macOS does not).
let ipPort = 0;

before(async () => {
  if (!hasOpenssl) return;
  makeCa("ca");
  makeCa("other-ca");
  makeServerCert("localhost-cert", "ca", "DNS:localhost");
  makeServerCert("other-name-cert", "ca", "DNS:db.other.example");
  makeServerCert("ip-cert", "ca", "IP:127.0.0.2");
  trustedPort = await startServer("localhost-cert");
  otherNamePort = await startServer("other-name-cert");
  ipPort = await startServer("ip-cert", "127.0.0.2").catch(() => 0);
});

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  rmSync(dir, { recursive: true, force: true });
});

const skip = hasOpenssl ? false : "openssl is not available to generate test certificates";

test("F-04: a certificate from the configured CA for the connected host is accepted", { skip }, async () => {
  const error = await connect(trustedPort, verifiedWith("ca.crt"));

  assert.equal(error.message, HANDSHAKE_ACCEPTED);
});

test("F-04: a certificate from another CA is refused", { skip }, async () => {
  const error = await connect(trustedPort, verifiedWith("other-ca.crt"));

  assert.notEqual(error.message, HANDSHAKE_ACCEPTED);
  assert.match(String(error.code), /CERT|SIGNATURE|ISSUER/);
});

test("F-04: a certificate from the right CA for another host name is refused", { skip }, async () => {
  const error = await connect(otherNamePort, verifiedWith("ca.crt"));

  assert.notEqual(error.message, HANDSHAKE_ACCEPTED);
  assert.equal(error.code, "ERR_TLS_CERT_ALTNAME_INVALID");
});

test("F-04: drizzle-kit's remote credentials verify the certificate the same way", { skip }, async () => {
  // drizzle-kit 0.31.11 opens `postgres({ ...credentials, max: 1 })` for field-by-field credentials (bin.cjs).
  // Only host and port are pointed at the stand-in; the TLS options are the ones built for the remote URL.
  const credentialsWith = (caFile: string) =>
    drizzleKitCredentials("postgres://libra@db.example.invalid:5432/libra", { DATABASE_CA_CERT: read(caFile) });

  for (const [caFile, accepted] of [
    ["ca.crt", true],
    ["other-ca.crt", false],
  ] as const) {
    const credentials = credentialsWith(caFile);
    assert.ok(!("url" in credentials));
    const error = await query(
      postgres({ ...credentials, host: "localhost", port: trustedPort, max: 1, connect_timeout: 5 }),
    );

    assert.equal(error.message === HANDSHAKE_ACCEPTED, accepted, caFile);
  }
});

test(
  "F-04: a remote IP address is verified against the IP in the certificate, not against localhost",
  { skip },
  async (t) => {
    if (!ipPort) return t.skip("127.0.0.2 cannot be bound on this system");

    for (const [caFile, accepted] of [
      ["ca.crt", true],
      ["other-ca.crt", false],
    ] as const) {
      const credentials = drizzleKitCredentials(`postgres://libra@127.0.0.2:${ipPort}/libra`, {
        DATABASE_CA_CERT: read(caFile),
      });
      assert.ok(!("url" in credentials));
      const error = await query(postgres({ ...credentials, max: 1, connect_timeout: 5 }));

      assert.equal(error.message === HANDSHAKE_ACCEPTED, accepted, caFile);
    }
  },
);

test('F-04: the previous `ssl: "require"` accepted both wrong certificates', { skip }, async () => {
  assert.equal((await connect(trustedPort, "require")).message, HANDSHAKE_ACCEPTED);
  assert.equal((await connect(otherNamePort, "require")).message, HANDSHAKE_ACCEPTED);
});
