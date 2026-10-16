import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import * as authRedirect from "../../../lib/auth-redirect";

const ORIGIN = "https://www.alyvenor.com";

type Exchange = { error: Error | null; cookies?: { name: string; value: string }[] };

// Transpiles a module and runs it with only the dependencies listed, so a forgotten import fails loudly.
function load<T>(file: URL, dependencies: Record<string, unknown>): T {
  const exports = {} as T;
  compileFunction(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports;
}

// The real route and the real server client factory; only Next's cookie store and Supabase are replaced. The
// exchange writes its session through the factory's setAll, as @supabase/ssr does.
function loadCallback(exchange: Exchange = { error: null }) {
  const exchanged: string[] = [];
  const cookieStore = new Map<string, string>();
  const server = load<typeof import("../../../lib/supabase/server")>(
    new URL("../../../lib/supabase/server.ts", import.meta.url),
    {
      "next/headers": {
        cookies: async () => ({
          getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
          set: (name: string, value: string) => cookieStore.set(name, value),
        }),
      },
      "@supabase/ssr": {
        createServerClient: (
          _url: string,
          _key: string,
          options: { cookies: { setAll(cookies: { name: string; value: string; options: object }[]): void } },
        ) => ({
          auth: {
            exchangeCodeForSession: async (code: string) => {
              exchanged.push(code);
              if (!exchange.error) options.cookies.setAll((exchange.cookies ?? []).map((c) => ({ ...c, options: {} })));
              return { data: {}, error: exchange.error };
            },
          },
        }),
      },
      "./config": { getSupabaseConfig: () => ({ url: "https://project.supabase.test", publishableKey: "public" }) },
    },
  );
  const route = load<typeof import("./route")>(new URL("./route.ts", import.meta.url), {
    "next/server": { NextResponse },
    "@/lib/supabase/server": server,
    "@/lib/auth-redirect": authRedirect,
  });

  return {
    callback: (query: string) => route.GET(new Request(`${ORIGIN}/auth/callback${query}`)),
    exchanged,
    cookieStore,
  };
}

function location(response: Response) {
  return response.headers.get("location");
}

test("a valid code is exchanged once and the session cookies are written before redirecting to next", async () => {
  const session = [{ name: "sb-project-auth-token", value: "session" }];
  const { callback, exchanged, cookieStore } = loadCallback({ error: null, cookies: session });

  const response = await callback("?code=abc&next=%2Fen%2Flibrary%3Fview%3Dgrid");

  assert.equal(response.status, 307);
  assert.equal(location(response), `${ORIGIN}/en/library?view=grid`);
  assert.deepEqual(exchanged, ["abc"]);
  // Next.js appends the request's mutable cookies to the Route Handler's redirect response.
  assert.equal(cookieStore.get("sb-project-auth-token"), "session");
});

test("P1: a Supabase error without a code reaches the localized login with the callback message, never the provider text", async () => {
  for (const [query, expected] of [
    [
      "?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&next=%2Fen%2Freset-password",
      "/en/login?error=auth_callback",
    ],
    ["?error=access_denied&next=%2Fes%2Flibrary", "/es/login?error=auth_callback"],
    ["?error_code=otp_expired", "/es/login?error=auth_callback"],
    ["?error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E&next=%2Fen", "/en/login?error=auth_callback"],
  ] as const) {
    const { callback, exchanged, cookieStore } = loadCallback();
    const response = await callback(query);

    assert.equal(location(response), `${ORIGIN}${expected}`, query);
    assert.deepEqual(exchanged, []);
    assert.equal(cookieStore.size, 0);
  }
});

test("a callback with neither a code nor an error keeps redirecting to the plain login", async () => {
  for (const [query, expected] of [
    ["", "/es/login"],
    ["?next=%2Fen%2Flibrary", "/en/login"],
  ] as const) {
    const { callback, exchanged } = loadCallback();

    assert.equal(location(await callback(query)), `${ORIGIN}${expected}`);
    assert.deepEqual(exchanged, []);
  }
});

test("a failed code exchange (expired code, missing PKCE verifier) reaches the login with the callback message", async () => {
  const { callback, exchanged, cookieStore } = loadCallback({ error: new Error("PKCE code verifier not found") });

  const response = await callback("?code=abc&next=%2Fen%2Freset-password");

  assert.equal(location(response), `${ORIGIN}/en/login?error=auth_callback`);
  assert.deepEqual(exchanged, ["abc"]);
  assert.equal(cookieStore.size, 0);
});

test("a malicious next never leaves the site, with or without an error", async () => {
  for (const next of ["https://evil.test/es", "//evil.test/es", "/\\evil.test", "/es/../../evil", "/fr/library"]) {
    const encoded = encodeURIComponent(next);

    const success = await loadCallback().callback(`?code=abc&next=${encoded}`);
    assert.equal(new URL(location(success)!).origin, ORIGIN, next);
    assert.match(new URL(location(success)!).pathname, /^\/(es|en)(\/|$)/, next);

    const failure = await loadCallback().callback(`?error=access_denied&next=${encoded}`);
    assert.equal(location(failure), `${ORIGIN}/es/login?error=auth_callback`, next);
  }
});
