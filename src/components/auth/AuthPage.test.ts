import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import React, { type ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import { safeNextPath } from "../../lib/auth-redirect";

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

function AuthForm() {
  return null;
}

// Loads AuthPage.tsx with its dependencies replaced, so the page renders without Next.js or Supabase.
function loadAuthPage(signedIn: boolean) {
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next-intl/server": { getLocale: async () => "es" },
    "next/navigation": {
      redirect: (url: string) => {
        throw new Redirected(url);
      },
    },
    "@/components/auth/AuthForm": { AuthForm },
    "@/lib/auth-state": { isAuthenticated: async () => signedIn },
    "@/lib/auth-redirect": { safeNextPath },
  };
  const exports = {} as typeof import("./AuthPage");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./AuthPage.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports.AuthPage;
}

async function renderForm(
  mode: "login" | "register",
  searchParams: Record<string, string | string[]>,
  signedIn = false,
) {
  const page = loadAuthPage(signedIn)({ mode, searchParams: Promise.resolve(searchParams) }) as ReactElement<{
    children: ReactElement;
  }>;
  const content = page.props.children;

  return (await (content.type as (props: unknown) => Promise<ReactElement>)(content.props)) as ReactElement<{
    passwordReset: boolean;
  }>;
}

test("F-03: only ?reset=done on the login page selects the password-reset notice", async () => {
  assert.equal((await renderForm("login", { reset: "done" })).props.passwordReset, true);

  const cases: ["login" | "register", Record<string, string | string[]>][] = [
    ["login", {}],
    ["login", { reset: "other" }],
    ["login", { reset: ["done", "done"] }],
    ["register", { reset: "done" }],
  ];

  for (const [mode, searchParams] of cases) {
    const form = await renderForm(mode, searchParams);

    assert.equal(form.type, AuthForm);
    assert.equal(form.props.passwordReset, false, JSON.stringify({ mode, searchParams }));
  }
});

test("F-03: a request that still holds a session never sees the notice; it is sent to the account page", async () => {
  await assert.rejects(renderForm("login", { reset: "done" }, true), (error: unknown) => {
    return error instanceof Redirected && error.url === "/es/account";
  });
});
