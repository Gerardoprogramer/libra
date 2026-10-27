import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chapterBlocksForStorage,
  CHAPTER_BLOCKS_VERSION,
  MAX_IMAGE_PATH_LENGTH,
  parseChapterBlocks,
  readStoredChapterBlocks,
  type ChapterBlock,
} from "./chapter-blocks";

// Storing and reading chapters.blocks: only blocks within the schema that derive the chapter's content are written
// or used; a chapter without blocks, or with unusable ones, is read from its content as before.

const blocks: ChapterBlock[] = [
  { type: "paragraph", content: [{ text: "The first " }, { text: "paragraph", marks: ["em"] }, { text: "." }] },
  {
    type: "figure",
    image: { path: "OEBPS/images/plate.jpg", mediaType: "image/jpeg" },
    alt: "A plate",
    caption: [{ text: "The caption." }],
  },
  { type: "verse", lines: [[{ text: "One line," }], [{ text: "another line." }]] },
];
const content = "The first paragraph.\n\nOne line, another line.";
const stored = { version: CHAPTER_BLOCKS_VERSION, blocks };

test("blocks that are valid and derive the chapter's content are accepted for storage", () => {
  assert.deepEqual(chapterBlocksForStorage(stored, content), stored);
  // What jsonb gives back (a parsed copy) reads the same.
  assert.deepEqual(readStoredChapterBlocks(JSON.parse(JSON.stringify(stored)), content), {
    status: "blocks",
    blocks: stored,
  });
});

test("blocks that do not derive the chapter's content are refused, so reading positions keep their paragraphs", () => {
  assert.throws(() => chapterBlocksForStorage(stored, "The first paragraph."), /do not derive the chapter's content/);
  assert.throws(() => chapterBlocksForStorage(stored, `${content}\n\nA paragraph more.`), /do not derive/);
  assert.equal(readStoredChapterBlocks(stored, "Different text.").status, "invalid");
});

test("blocks outside the schema are refused for storage and not used when read", () => {
  for (const value of [
    { version: 2, blocks },
    { version: 1, blocks: [{ type: "html", html: "<b>x</b>" }] },
    { version: 1, blocks: "not a list" },
    "a string",
    42,
  ]) {
    assert.throws(() => chapterBlocksForStorage(value, content), /Invalid chapter blocks/, JSON.stringify(value));
    const read = readStoredChapterBlocks(value, content);
    assert.equal(read.status, "invalid");
  }
});

test("a chapter without blocks is read from its content, as before blocks existed", () => {
  assert.deepEqual(readStoredChapterBlocks(null, content), { status: "absent" });
  assert.deepEqual(readStoredChapterBlocks(undefined, content), { status: "absent" });
});

test("figure image paths are limited to 1024 characters, the limit of edition_assets.source_path", () => {
  assert.equal(MAX_IMAGE_PATH_LENGTH, 1024);
  const figure = (path: string) => ({
    version: CHAPTER_BLOCKS_VERSION,
    blocks: [{ type: "figure", image: { path, mediaType: "image/png" }, alt: "", caption: [] }],
  });
  const atLimit = `OEBPS/${"a".repeat(MAX_IMAGE_PATH_LENGTH - "OEBPS/.png".length)}.png`;
  assert.equal(atLimit.length, MAX_IMAGE_PATH_LENGTH);
  assert.deepEqual(parseChapterBlocks(figure(atLimit)), figure(atLimit));
  assert.throws(() => parseChapterBlocks(figure(`a${atLimit}`)), /path is longer than 1024 characters/);
  // Counted in characters like PostgreSQL, not UTF-16 units: 1024 astral characters fit, 1025 do not.
  const astral = "😀".repeat(MAX_IMAGE_PATH_LENGTH);
  assert.ok(astral.length > MAX_IMAGE_PATH_LENGTH);
  assert.ok(parseChapterBlocks(figure(astral)));
  assert.throws(() => parseChapterBlocks(figure(`😀${astral}`)), /longer than 1024/);
  // Paths that were valid stay valid.
  for (const path of ["OEBPS/images/plate-1.png", "image.jpg", "a/.hidden/b.png"]) {
    assert.ok(parseChapterBlocks(figure(path)), path);
  }
});
