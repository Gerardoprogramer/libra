import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import recorded from "./epub-corpus-baseline.json";
import { fingerprintEpub, type EpubFingerprint } from "./epub-corpus-baseline";

// Compares the current extraction of each local catalogue EPUB with the fingerprint recorded before chapters gain
// structured blocks (see epub-corpus-baseline.ts). imports/ is untracked, so in CI these comparisons are skipped;
// LIBRA_EPUB_CORPUS_DIR points them at another directory of the same files. A file whose bytes differ from the
// recorded one is skipped too: the baseline describes that exact file and says nothing about another edition.

const books: Record<string, EpubFingerprint> = recorded.books;
const directory =
  process.env.LIBRA_EPUB_CORPUS_DIR ?? path.join(fileURLToPath(new URL("../../", import.meta.url)), "imports");

test("the recorded corpus baseline is internally consistent", () => {
  assert.ok(Object.keys(books).length > 0);

  for (const [file, book] of Object.entries(books)) {
    assert.deepEqual(
      book.chapters.map((chapter) => chapter.number),
      book.chapters.map((_, index) => index + 1),
      file,
    );
    assert.equal(new Set(book.chapters.map((chapter) => chapter.slug)).size, book.chapters.length, file);
    assert.ok(
      book.chapters.every((chapter) => /^[0-9a-f]{64}$/.test(chapter.contentSha256)),
      file,
    );
    assert.ok(
      book.chapters.every((chapter) => chapter.paragraphs > 0 && chapter.wordCount > 0),
      file,
    );
    assert.equal(book.keptWords + book.discardedWords + book.leadingWords, book.totalWords, file);
    // Every image drawn in the text comes from the markup; the inventory never counts more of a kind than in total.
    assert.ok(book.markup.letterImages <= book.markup.images && book.markup.headingImages <= book.markup.images, file);
  }
});

for (const [file, expected] of Object.entries(books)) {
  const filePath = path.join(directory, file);
  const present = fs.existsSync(filePath);
  const buffer = present ? fs.readFileSync(filePath) : null;
  const skip = !buffer
    ? "EPUB not present (imports/ is untracked; set LIBRA_EPUB_CORPUS_DIR to compare)"
    : createHash("sha256").update(buffer).digest("hex") !== expected.fileSha256
      ? "a different file than the one the baseline was recorded from"
      : false;

  test(`corpus baseline: ${file} extracts the same chapters, text and markup inventory`, { skip }, async () => {
    const actual = await fingerprintEpub(buffer!);

    // Chapter by chapter first, so a difference names the chapter instead of dumping the whole book.
    assert.equal(actual.chapters.length, expected.chapters.length, "chapter count");
    for (const [index, chapter] of expected.chapters.entries()) {
      assert.deepEqual(actual.chapters[index], chapter, `chapter ${chapter.number} (${chapter.slug})`);
    }
    assert.deepEqual(actual, expected);
  });
}
