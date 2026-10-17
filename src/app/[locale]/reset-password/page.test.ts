import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import React, { isValidElement, type ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

function PasswordResetForm() {
  return null;
}

// Loads page.tsx with its dependencies replaced, so the page renders without Next.js, next-intl or Supabase.
function loadPage(hasRecoverySession: () => Promise<boolean>) {
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next-intl/server": { getTranslations: async () => (key: string) => key },
    "@/components/auth/PasswordForms": { PasswordResetForm },
    "@/components/ui/button": { Button: () => null },
    "@/i18n/navigation": { Link: () => null },
    "@/lib/auth-state": { hasRecoverySession },
  };
  const exports = {} as { default: () => ReactElement<{ children: ReactElement }> };
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports.default;
}

// Renders the page's async content component, which sits inside its Suspense boundary.
async function renderContent(hasRecoverySession: () => Promise<boolean>) {
  const page = loadPage(hasRecoverySession)();
  const content = page.props.children as ReactElement;

  return (await (content.type as () => Promise<ReactElement>)()) as ReactElement;
}

function containsText(node: unknown, text: string): boolean {
  if (node === text) return true;
  if (Array.isArray(node)) return node.some((child) => containsText(child, text));
  return isValidElement(node) && containsText((node.props as { children?: unknown }).children, text);
}

test("F-03: only a session opened from the reset link is shown the new-password form", async () => {
  const result = await renderContent(async () => true);

  assert.equal(result.type, PasswordResetForm);
});

test("F-03: without a recovery session (none, or an ordinary sign-in) the page offers a new link instead", async () => {
  const result = await renderContent(async () => false);

  assert.notEqual(result.type, PasswordResetForm);
  assert.ok(containsText(result, "resetLinkInvalid"));
  assert.ok(!containsText(result, "savePassword"));
});
