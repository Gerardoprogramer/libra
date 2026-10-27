import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import recorded from "./epub-corpus-baseline.json";
import { fingerprintEpub, type EpubFingerprint } from "./epub-corpus-baseline";
import { parseEpub } from "./parse-epub";
import { createSharpCodec } from "./sharp-codec";

// The local catalogue EPUBs parsed as an import parses them, every figure image normalized by sharp: the chapters,
// text and blocks are exactly the recorded baseline, every figure with an image has its normalized image, and none is
// rejected. Read-only: the EPUBs are read, nothing is uploaded or written. Skipped like the baseline comparison when
// the files are absent or different (imports/, or LIBRA_EPUB_CORPUS_DIR). The local files are not necessarily the
// ones imported in production; this says nothing about those.

const books: Record<string, EpubFingerprint> = recorded.books;
const directory =
  process.env.LIBRA_EPUB_CORPUS_DIR ?? path.join(fileURLToPath(new URL("../../", import.meta.url)), "imports");
const codec = createSharpCodec();

for (const [file, expected] of Object.entries(books)) {
  const filePath = path.join(directory, file);
  const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const skip = !buffer
    ? "EPUB not present (imports/ is untracked; set LIBRA_EPUB_CORPUS_DIR to compare)"
    : createHash("sha256").update(buffer).digest("hex") !== expected.fileSha256
      ? "a different file than the one the baseline was recorded from"
      : false;

  test(`corpus images: ${file} normalizes every figure image without changing its chapters`, { skip }, async () => {
    const fingerprint = await fingerprintEpub(buffer!, { codec });
    assert.deepEqual(fingerprint.chapters, expected.chapters);

    const parsed = await parseEpub(buffer!, {}, { codec });
    assert.deepEqual(parsed.imageWarnings, []);
    const paths = new Set(
      parsed.chapters.flatMap((chapter) =>
        chapter.blocks.blocks.flatMap((block) => (block.type === "figure" && block.image ? [block.image.path] : [])),
      ),
    );
    assert.deepEqual(
      parsed.images?.map((image) => image.sourcePath),
      [...paths].sort(),
    );
    for (const image of parsed.images ?? []) {
      assert.equal(image.sha256, createHash("sha256").update(image.data).digest("hex"));
      assert.ok(image.width <= image.maxWidth);
    }
  });
}
