import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ChapterText, CHAPTER_BLOCKS_VERSION, countChapterWords } from "./chapter-blocks";

// Every write of chapters.content goes through ChapterText: its blocks are validated against the exact text written
// with them, and the three text columns are always written together. The second half reads the repository's own
// source: a chapter write anywhere else, or one that sets the text columns by hand, fails here.

const content = "The first paragraph.\n\nThe second one.";
const blocks = {
  version: CHAPTER_BLOCKS_VERSION,
  blocks: [
    { type: "paragraph", content: [{ text: "The first " }, { text: "paragraph", marks: ["em"] }, { text: "." }] },
    { type: "figure", image: { path: "OEBPS/images/a.png", mediaType: "image/png" }, alt: "A", caption: [] },
    { type: "paragraph", content: [{ text: "The second one." }] },
  ],
};

test("ChapterText.withBlocks validates untrusted blocks against the text and gives the three columns", () => {
  const text = ChapterText.withBlocks(content, JSON.parse(JSON.stringify(blocks)));
  assert.deepEqual(text.columns(), { content, wordCount: 6, blocks });
  assert.equal(text.wordCount, countChapterWords(content));
});

test("ChapterText refuses blocks outside the contract instead of storing or repairing them", () => {
  for (const [value, pattern] of [
    [{ version: 2, blocks: [] }, /unsupported version/],
    [{ version: 1, blocks: [{ type: "html", html: "<b>x</b>" }] }, /unknown block type/],
    [{ version: 1, blocks: [{ type: "paragraph", content: [{ text: "x", marks: ["blink"] }] }] }, /unknown mark/],
    [{ ...blocks, extra: true }, /unknown field extra/],
    [
      {
        version: 1,
        blocks: [
          ...blocks.blocks,
          { type: "figure", image: { path: "../outside.png", mediaType: "image/png" }, alt: "", caption: [] },
        ],
      },
      /normalized relative path/,
    ],
    [
      {
        version: 1,
        blocks: [{ type: "figure", image: { path: "https://x/a.png", mediaType: "image/png" }, alt: "", caption: [] }],
      },
      /normalized relative path/,
    ],
    [{ version: 1, blocks: [{ type: "paragraph", content: [{ text: "Other text." }] }] }, /do not derive/],
  ] as const) {
    assert.throws(() => ChapterText.withBlocks(content, value), pattern, JSON.stringify(value));
  }
  // Missing blocks are never invented: a chapter without them says so explicitly.
  assert.throws(() => ChapterText.withBlocks(content, null), /use ChapterText\.textOnly/);
  assert.throws(() => ChapterText.withBlocks(content, undefined), /use ChapterText\.textOnly/);
});

test("ChapterText.textOnly writes NULL blocks explicitly, so new text never keeps old blocks", () => {
  assert.deepEqual(ChapterText.textOnly("Only text.").columns(), {
    content: "Only text.",
    wordCount: 2,
    blocks: null,
  });
  assert.equal(countChapterWords("  "), 0);
});

/* The repository's chapter writes. */

const root = fileURLToPath(new URL("../../", import.meta.url));

function sources(directory: string): string[] {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(relative);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [relative] : [];
  });
}

/**
 * Where chapters are written, and why there. The importer writes imported chapters with their blocks; the seed writes
 * development text without blocks. Adding a file here needs the same justification.
 */
const ALLOWED_WRITERS: Record<string, string> = {
  "scripts/lib/import-database.ts": "imported chapters, ChapterText.withBlocks",
  "scripts/seed.ts": "local development text, ChapterText.textOnly",
};

const files = [...sources("scripts"), ...sources("src")];

test("chapters are written only by the allowed files, and never through raw SQL", () => {
  const writers = new Set<string>();
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (/\.(?:insert|update)\(\s*(?:schema\.)?chapters\s*\)/.test(text)) writers.add(file);
    assert.doesNotMatch(
      text,
      /\b(?:insert\s+into|update)\s+"?(?:public"?\.)?"?chapters"?\s/i,
      `${file} writes chapters through raw SQL`,
    );
  }
  assert.deepEqual([...writers].sort(), Object.keys(ALLOWED_WRITERS).sort());
});

/** The chapter writes in a source text, and what is wrong with each. */
function chapterWrites(text: string) {
  return [...text.matchAll(/\.(insert|update)\(\s*(?:schema\.)?chapters\s*\)/g)].map((match) => {
    // The statement: the chained call up to the semicolon that ends it.
    const statement = text.slice(match.index, text.indexOf(";", match.index));
    const problems: string[] = [];
    if (/[{,]\s*(?:content|blocks|wordCount)\s*[:,}]/.test(statement)) problems.push("sets a text column by hand");
    for (const spread of statement.matchAll(/\.\.\.([^,}\n]+)/g)) {
      if (!/\.columns\(\)$/.test(spread[1].trim())) problems.push(`spreads ${spread[1].trim()}`);
    }
    if (match[1] === "insert" && !/\.columns\(\)/.test(statement)) problems.push("inserts without ChapterText");
    return { kind: match[1], problems };
  });
}

test("the write check refuses text columns set by hand, other spreads and inserts without ChapterText", () => {
  const problems = (source: string) => chapterWrites(source).flatMap((write) => write.problems);
  assert.deepEqual(problems("tx.insert(chapters).values({ editionId, ...text.columns() });"), []);
  assert.deepEqual(problems("tx.update(chapters).set({ slug, number: 1 }).where(x);"), []);
  assert.match(problems("tx.insert(chapters).values({ editionId, content: c, wordCount: 3 });").join(), /by hand/);
  assert.match(problems("tx.update(chapters).set({ title, content });").join(), /by hand/);
  assert.match(problems("tx.update(chapters).set({ ...values(change) });").join(), /spreads values\(change\)/);
  assert.match(problems("db.insert(schema.chapters).values(row);").join(), /without ChapterText/);
  assert.match(problems("tx.update(chapters).set({ blocks: null });").join(), /by hand/);
});

test("every chapter write takes its text columns from ChapterText.columns(), never set by hand", () => {
  const writes = Object.keys(ALLOWED_WRITERS).flatMap((file) =>
    chapterWrites(fs.readFileSync(path.join(root, file), "utf8")).map((write) => ({ file, ...write })),
  );
  assert.deepEqual(
    writes.filter((write) => write.problems.length),
    [],
  );
  // The importer inserts and rewrites chapters and vacates slugs; the seed upserts: four writes, all checked.
  assert.deepEqual(
    writes.map((write) => `${write.file} ${write.kind}`),
    [
      "scripts/lib/import-database.ts update",
      "scripts/lib/import-database.ts insert",
      "scripts/lib/import-database.ts update",
      "scripts/seed.ts insert",
    ],
  );
});
