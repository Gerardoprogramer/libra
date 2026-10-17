import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

import * as recoverySession from "./recovery-session";

// Loads auth-state.ts with Supabase replaced; `server-only` and React's per-request cache are not needed here.
function loadAuthState(getClaims: () => Promise<{ data: { claims: unknown } | null; error: unknown }>) {
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    react: { cache: <T>(fn: T) => fn },
    "@/lib/recovery-session": recoverySession,
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims } }) },
  };
  const exports = {} as typeof import("./auth-state");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./auth-state.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports;
}

// The recovery check compares the amr time with the real clock, so the claims are dated just now.
const at = Math.floor(Date.now() / 1000);

test("F-03: a password sign-in is authenticated but is not offered the password reset", async () => {
  const state = loadAuthState(async () => ({
    data: { claims: { sub: "user-1", amr: [{ method: "password", timestamp: at }] } },
    error: null,
  }));

  assert.equal(await state.isAuthenticated(), true);
  assert.equal(await state.hasRecoverySession(), false);
});

test("F-03: a session from the reset link is authenticated and offered the password reset", async () => {
  const state = loadAuthState(async () => ({
    data: { claims: { sub: "user-1", amr: [{ method: "recovery", timestamp: at }] } },
    error: null,
  }));

  assert.equal(await state.isAuthenticated(), true);
  assert.equal(await state.hasRecoverySession(), true);
});

test("F-03: a reset link session opened long ago is still authenticated but no longer offered the password reset", async () => {
  const state = loadAuthState(async () => ({
    data: { claims: { sub: "user-1", iat: at, amr: [{ method: "recovery", timestamp: at - 24 * 60 * 60 }] } },
    error: null,
  }));

  assert.equal(await state.isAuthenticated(), true);
  assert.equal(await state.hasRecoverySession(), false);
});

test("F-03: claims that fail verification count as no session, whatever their amr says", async () => {
  for (const result of [
    { data: null, error: new Error("invalid JWT") },
    { data: { claims: { sub: "user-1", amr: [{ method: "recovery", timestamp: at }] } }, error: new Error("expired") },
    { data: { claims: { amr: [{ method: "recovery", timestamp: at }] } }, error: null },
    { data: null, error: null },
  ]) {
    const state = loadAuthState(async () => result);

    assert.equal(await state.isAuthenticated(), false);
    assert.equal(await state.hasRecoverySession(), false);
  }
});
