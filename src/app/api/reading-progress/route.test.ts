import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as schema from "../../../db/schema";
import * as visibility from "../../../db/queries/editorial-visibility";
import * as validation from "../../../lib/reading-progress-input";
import * as bodyLimit from "../../../lib/read-limited-body";

const A = "10000000-0000-0000-0000-000000000001";
const B = "10000000-0000-0000-0000-000000000002";
const position = {
  userId: A,
  editionId: "20000000-0000-0000-0000-000000000001",
  chapterId: "30000000-0000-0000-0000-000000000001",
  paragraphIndex: 5,
  percentage: 40,
  updatedAt: "2026-01-01T00:00:00.000Z",
};
function handler(userId: string | null = A, rows: unknown[][] = [[A]]) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    statements.push({ sql, params });
    return { rows };
  });
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": orm,
    "next/server": { NextResponse },
    "@/db": { db },
    "@/db/schema": schema,
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getClaims: async () => ({ data: { claims: { sub: userId } }, error: null }) },
      }),
    },
    "@/db/queries/editorial-visibility": visibility,
    "@/lib/reading-progress-input": validation,
    "@/lib/read-limited-body": bodyLimit,
  };
  const exports = {} as typeof import("./route");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return { ...exports, statements };
}
function request(body: unknown = position, origin = "https://www.alyvenor.com") {
  return new Request("https://www.alyvenor.com/api/reading-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
test("progress writes reject guests, session changes, foreign origins and invalid inputs before SQL", async () => {
  for (const [owner, body, origin, status] of [
    [null, position, "https://www.alyvenor.com", 401],
    [B, position, "https://www.alyvenor.com", 403],
    [A, position, "https://evil.test", 403],
    [A, { ...position, percentage: 101 }, "https://www.alyvenor.com", 400],
    [A, { ...position, chapterId: "invalid" }, "https://www.alyvenor.com", 400],
    [A, { ...position, paragraphIndex: -1 }, "https://www.alyvenor.com", 400],
  ] as const) {
    const h = handler(owner);
    assert.equal((await h.POST(request(body, origin))).status, status);
    assert.equal(h.statements.length, 0);
  }
});
test("progress SQL validates public chapter/edition and atomically guards timestamp ordering for the verified owner", async () => {
  const h = handler();
  const result = await h.POST(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { accepted: true });
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  const [read, write] = h.statements;
  assert.ok(read.params.includes(position.editionId));
  assert.ok(read.params.includes(position.chapterId));
  assert.ok(read.params.includes("PUBLISHED"));
  assert.match(write.sql, /on conflict \("user_id","edition_id"\) do update/);
  assert.match(write.sql, /where "reading_progress"\."updated_at" <= .*::timestamptz/);
  assert.ok(write.params.includes(A));
});
test("unavailable chapters are not persisted; history only selects the authenticated user's public editions", async () => {
  const h = handler(A, []);
  assert.equal((await h.POST(request())).status, 404);
  assert.equal(h.statements.length, 1);
  assert.equal((await h.GET(new Request("https://www.alyvenor.com/api/reading-progress"))).status, 200);
  const query = h.statements[1];
  assert.match(query.sql, /where \("reading_progress"\."user_id" = /);
  assert.ok(query.params.includes(A));
  assert.ok(query.params.includes("PUBLISHED"));
});

test("the book action can fetch an older edition outside the recent-history limit", async () => {
  const h = handler(A, []);
  const response = await h.GET(
    new Request(`https://www.alyvenor.com/api/reading-progress?edition=${position.editionId}`),
  );
  assert.equal(response.status, 200);
  assert.ok(h.statements[0].params.includes(position.editionId));
  assert.ok(h.statements[0].params.includes(A));
});

test("L20: a client clock ahead of the server never stores a time later than the server's own", async () => {
  const ahead = new Date(Date.now() + 240_000).toISOString();
  const h = handler();

  assert.equal((await h.POST(request({ ...position, updatedAt: ahead }))).status, 200);

  const timestamps = h.statements[1].params.filter(
    (value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value),
  );
  assert.ok(timestamps.length >= 2, "both the inserted value and the ordering guard carry the time");
  for (const timestamp of timestamps) {
    assert.notEqual(timestamp, ahead);
    assert.ok(Date.parse(timestamp) <= Date.now());
  }
});

test("L20: timestamps from before the service existed, or far in the future, are rejected before SQL", async () => {
  for (const updatedAt of ["2019-12-31T23:59:59.000Z", new Date(Date.now() + 3_600_000).toISOString()]) {
    const h = handler();
    assert.equal((await h.POST(request({ ...position, updatedAt }))).status, 400);
    assert.equal(h.statements.length, 0);
  }
});

function rawRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://www.alyvenor.com/api/reading-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://www.alyvenor.com", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

// A valid position padded with JSON whitespace to an exact size in bytes.
function paddedPosition(bytes: number) {
  const json = JSON.stringify(position);
  return json + " ".repeat(bytes - Buffer.byteLength(json));
}

test("F-02: a valid body of exactly 4096 bytes is accepted and saved", async () => {
  const h = handler();
  const response = await h.POST(rawRequest(paddedPosition(4096)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(h.statements.length, 2);
});

test("F-02: a body over 4096 bytes is refused with 413 before authentication or SQL", async () => {
  for (const body of [paddedPosition(4097), JSON.stringify({ ...position, pad: "é".repeat(2100) })]) {
    const h = handler();
    const response = await h.POST(rawRequest(body));
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "Payload too large." });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(h.statements.length, 0);
  }
});

test("F-02: a streamed body without Content-Length is cut off at the limit with 413", async () => {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1024;
      controller.enqueue(new Uint8Array(1024).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = rawRequest(stream);
  assert.equal(request.headers.get("content-length"), null);

  const h = handler();
  assert.equal((await h.POST(request)).status, 413);
  assert.ok(cancelled);
  assert.ok(pulled <= 4096 + 3 * 1024, `pulled ${pulled} bytes`);
  assert.equal(h.statements.length, 0);
});

test("F-02: empty, invalid JSON and invalid UTF-8 bodies are refused with 400 before SQL", async () => {
  for (const body of ["", "{", "not json", new Uint8Array([0x7b, 0xff, 0x7d])]) {
    const h = handler();
    const response = await h.POST(rawRequest(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid progress." });
    assert.equal(h.statements.length, 0);
  }
});
