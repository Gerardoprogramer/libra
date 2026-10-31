import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import * as readingProgress from "../../lib/reading-progress";
import type { ReadingProgress } from "../../lib/reading-progress";

const editionId = "29e40d31-1e34-4382-a7f9-64b082806fe0";
const stub = (name: string) => Object.assign(() => null, { displayName: name });
const Link = stub("Link");

// Loads the component with the reading history replaced, so it renders without a browser, storage or Supabase.
function loadComponent(entries: ReadingProgress[]) {
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "react-icons/fi": { FiBookOpen: stub("FiBookOpen") },
    "@/components/ui/button": { Button: stub("Button") },
    "@/i18n/navigation": { Link },
    "@/lib/reading-progress": readingProgress,
    "@/lib/use-reading-history": { useReadingHistory: () => ({ entries }) },
  };
  const exports = {} as typeof import("./BookReadingAction");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./BookReadingAction.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports.BookReadingAction;
}

function findLinkHref(node: unknown): string | undefined {
  if (Array.isArray(node)) return node.map(findLinkHref).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<{ href?: string; children?: unknown }>;
  return element.type === Link ? element.props.href : findLinkHref(element.props.children);
}

function renderHref(entries: ReadingProgress[]) {
  return findLinkHref(
    loadComponent(entries)({
      bookSlug: "dracula",
      editionId,
      chapterSlugs: ["chapter-i", "chapter-ii", "chapter-iii"],
      firstChapterSlug: "chapter-i",
      startLabel: "Start",
      continueLabel: "Continue",
      readAgainLabel: "Read again",
      progressLabel: "{progress}%",
    }),
  );
}

const progress = (chapterSlug: string, chapterIndex: number, percentage = 40): ReadingProgress => ({
  bookSlug: "dracula",
  editionId,
  chapterSlug,
  chapterTitle: chapterSlug,
  chapterNumber: chapterIndex + 1,
  chapterIndex,
  totalChapters: 3,
  percentage,
  updatedAt: "2026-10-31T00:00:00.000Z",
});

test("the book page links its first chapter by the clean URL, without ?edition=", () => {
  assert.equal(renderHref([]), "/books/dracula/chapter-i");
});

test("reading progress still leads to the chapter being read, by its clean URL", () => {
  assert.equal(renderHref([progress("chapter-ii", 1)]), "/books/dracula/chapter-ii");
  // Progress of another edition is not this page's, so the first chapter is offered.
  assert.equal(
    renderHref([{ ...progress("chapter-ii", 1), editionId: "another-edition" }]),
    "/books/dracula/chapter-i",
  );
  // A finished book starts again from the first chapter.
  assert.equal(renderHref([progress("chapter-iii", 2, 100)]), "/books/dracula/chapter-i");
});
