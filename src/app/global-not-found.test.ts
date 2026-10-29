import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import * as notFoundLocale from "../lib/not-found-locale";

// Loads global-not-found.tsx with the request header and the font replaced: no Next.js runtime or network access.
function loadPage(locale: string | null) {
  const dependencies: Record<string, unknown> = {
    "./globals.css": {},
    "react/jsx-runtime": jsxRuntime,
    "next/headers": {
      headers: async () => new Headers(locale ? { [notFoundLocale.LOCALE_HEADER]: locale } : {}),
    },
    "../../messages/en.json": { __esModule: true, default: en },
    "../../messages/es.json": { __esModule: true, default: es },
    "../lib/fonts/editorial": { editorialFont: { variable: "font" } },
    "../lib/not-found-locale": notFoundLocale,
  };
  const exports = {} as typeof import("./global-not-found");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./global-not-found.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports;
}

// Vercel serves a prerendered /_not-found that carries only the metadata the page declares, so noindex must be one.
test("the global 404 declares noindex itself, with its localized title", async () => {
  for (const [locale, title] of [
    ["es", es.errors.notFoundTitle],
    ["en", en.errors.notFoundTitle],
  ] as const) {
    const metadata = await loadPage(locale).generateMetadata();

    assert.equal(metadata.title, `${title} — Libra`);
    assert.deepEqual(metadata.robots, { index: false });
  }
});
