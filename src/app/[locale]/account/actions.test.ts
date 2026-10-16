import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import { hasLocale } from "next-intl";
import ts from "typescript";

import { routing } from "../../../i18n/routing";

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

// Loads actions.ts with its dependencies replaced, so the action runs without Next.js or Supabase.
function loadActions(signOutResult: { error: Error | null }) {
  const cacheCalls: string[] = [];
  const signOutCalls: unknown[] = [];
  const recordCache =
    (name: string) =>
    (...args: unknown[]) => {
      cacheCalls.push(`${name}(${JSON.stringify(args)})`);
    };
  const dependencies: Record<string, unknown> = {
    "next-intl": { hasLocale },
    "next/navigation": {
      redirect: (url: string) => {
        throw new Redirected(url);
      },
    },
    "next/cache": {
      revalidatePath: recordCache("revalidatePath"),
      revalidateTag: recordCache("revalidateTag"),
      updateTag: recordCache("updateTag"),
      refresh: recordCache("refresh"),
    },
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: {
          signOut: async (options: unknown) => {
            signOutCalls.push(options);
            return signOutResult;
          },
        },
      }),
    },
    "@/i18n/routing": { routing },
  };
  const exports = {} as typeof import("./actions");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return { signOut: exports.signOut, cacheCalls, signOutCalls };
}

function form(locale?: string) {
  const data = new FormData();
  if (locale !== undefined) data.set("locale", locale);
  return data;
}

test("signing out ends the local session and redirects to the requested locale without invalidating any cache", async () => {
  for (const locale of ["es", "en"]) {
    const { signOut, cacheCalls, signOutCalls } = loadActions({ error: null });

    await assert.rejects(signOut(form(locale)), (error: unknown) => (error as Redirected).url === `/${locale}`);
    assert.deepEqual(signOutCalls, [{ scope: "local" }]);
    assert.deepEqual(cacheCalls, []);
  }
});

test("an unknown or missing locale redirects to the default locale", async () => {
  for (const data of [form("fr"), form("../en"), form()]) {
    const { signOut, cacheCalls } = loadActions({ error: null });

    await assert.rejects(signOut(data), (error: unknown) => (error as Redirected).url === `/${routing.defaultLocale}`);
    assert.deepEqual(cacheCalls, []);
  }
});

test("a call without a session (Supabase returns no error) cannot invalidate the site's cache", async () => {
  // Supabase's signOut ignores a missing session and resolves without an error, so the action runs to the end.
  const { signOut, cacheCalls } = loadActions({ error: null });

  await assert.rejects(signOut(form("es")), Redirected);
  assert.deepEqual(cacheCalls, []);
});

test("a failed sign-out is reported instead of redirecting as if it had succeeded", async () => {
  const failure = new Error("sign-out failed");
  const { signOut, cacheCalls } = loadActions({ error: failure });

  await assert.rejects(signOut(form("en")), (error: unknown) => error === failure);
  assert.deepEqual(cacheCalls, []);
});

test("the action never imports Next.js cache invalidation", () => {
  const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from "next\/cache"/);
  assert.doesNotMatch(source, /\b(revalidatePath|revalidateTag|updateTag)\(/);
});
