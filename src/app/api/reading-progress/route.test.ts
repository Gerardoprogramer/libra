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
