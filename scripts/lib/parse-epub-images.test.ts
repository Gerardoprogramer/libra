import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import type { ChapterBlock } from "../../src/lib/chapter-blocks";
import { encodePng } from "./epub-image-fixtures";
import type { ImageCodec } from "./epub-images";
import { buildEpub3, epubFixtures, type FixtureResource } from "./epub-fixtures";
import { defaultEpubLimits, parseEpub, type ParsedEpub } from "./parse-epub";
import { createSharpCodec } from "./sharp-codec";

// The parser with a codec: every figure image is normalized, a rejected image leaves its figure without an image and
// a structured warning, and the text never changes. In memory only: nothing is uploaded or written.

const real = createSharpCodec();
const s = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label} sentence ${index + 1} keeps the reader company.`).join(" ");

const figures = (parsed: ParsedEpub) =>
  parsed.chapters.flatMap((chapter) =>
    chapter.blocks.blocks.filter(
      (block): block is Extract<ChapterBlock, { type: "figure" }> => block.type === "figure",
    ),
  );

/** The real codec, counting calls and rejecting the paths given. */
function codec(reject: string[] = []) {
  const calls: string[] = [];
  const wrapped: ImageCodec = {
    id: real.id,
    normalize: async (data, inspection, target) => {
      calls.push(`${inspection.sourceSha256}`);
      if (reject.includes(inspection.sourceSha256)) throw new Error("decoder refused the stream");
      return real.normalize(data, inspection, target);
    },
  };
  return { codec: wrapped, calls };
}

function illustrated(images: { href: string; data: Buffer }[], options: { title?: string } = {}) {
  const resources: FixtureResource[] = images.map(({ href, data }) => ({ href, mediaType: "image/png", data }));
  return buildEpub3({
    title: options.title ?? "Illustrated Fixture",
    documents: [
      {
        href: "chapter1.xhtml",
        body: `<h2>Chapter I</h2><p>${s("First", 3)}</p>${images.map(({ href }) => `<div class="figcenter"><img src="${href}" alt="Plate ${href}"/></div>`).join("")}<p>${s("After", 2)}</p>`,
      },
      { href: "chapter2.xhtml", body: `<h2>Chapter II</h2><p>${s("Second", 3)}</p>` },
    ],
    resources,
  });
}

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

test("with a codec, every figure with an image has its normalized image, and nothing else is listed", async () => {
  const epub = await epubFixtures.mixedChapters();
  const parsed = await parseEpub(epub, {}, { codec: real });
  const plain = await parseEpub(epub);

  // Same text and the same blocks as without a codec: the fixture's images all normalize.
  assert.deepEqual(
    parsed.chapters.map((chapter) => [chapter.content, chapter.blocks]),
    plain.chapters.map((chapter) => [chapter.content, chapter.blocks]),
  );
  const withImage = figures(parsed).filter((figure) => figure.image);
  assert.ok(withImage.length > 0);
  assert.ok(parsed.images);
  assert.deepEqual(
    parsed.images.map((image) => image.sourcePath),
    [...new Set(withImage.map((figure) => figure.image!.path))].sort(),
  );
  for (const image of parsed.images) {
    assert.equal(image.codec, real.id);
    assert.equal(image.maxWidth, defaultEpubLimits.images.maxNormalizedWidth);
    assert.equal(image.sha256, sha(image.data));
    assert.equal(image.key, `illustrations/${image.sha256}.png`);
  }
  // The unusable images of the fixture are warnings, with their chapter.
  assert.deepEqual(
    parsed.imageWarnings.map((warning) => [warning.chapter, warning.sourcePath, warning.code]),
    [
      [3, "OEBPS/images/missing.png", "missing"],
      [3, "OEBPS/images/broken.png", "truncated"],
    ],
  );
});

test("an image the codec rejects keeps its figure, alt and caption without an image, and becomes a warning", async () => {
  const good = encodePng({ width: 8, height: 6 });
  const bad = encodePng({ width: 9, height: 7 });
  const epub = await illustrated([
    { href: "images/good.png", data: good },
    { href: "images/bad.png", data: bad },
  ]);
  const { codec: rejecting } = codec([sha(bad)]);
  const parsed = await parseEpub(epub, {}, { codec: rejecting });
  const plain = await parseEpub(epub);

  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.content),
    plain.chapters.map((chapter) => chapter.content),
  );
  assert.deepEqual(
    figures(parsed).map((figure) => [figure.alt, figure.image?.path ?? null]),
    [
      ["Plate images/good.png", "OEBPS/images/good.png"],
      ["Plate images/bad.png", null],
    ],
  );
  assert.deepEqual(
    parsed.images?.map((image) => image.sourcePath),
    ["OEBPS/images/good.png"],
  );
  assert.equal(parsed.imageWarnings.length, 1);
  const [warning] = parsed.imageWarnings;
  assert.equal(warning.chapter, 1);
  assert.equal(warning.chapterTitle, parsed.chapters[0].title);
  assert.equal(warning.sourcePath, "OEBPS/images/bad.png");
  assert.equal(warning.code, "corrupt");
  assert.match(warning.reason, /does not decode: decoder refused the stream/);
});

test("a rejected image frees its place in the edition budget for a later one, which is normalized too", async () => {
  const first = encodePng({ width: 8, height: 6 });
  const second = encodePng({ width: 9, height: 7 });
  const epub = await illustrated([
    { href: "images/first.png", data: first },
    { href: "images/second.png", data: second },
  ]);
  const limits = { images: { ...defaultEpubLimits.images, maxImagesPerEdition: 1 } };

  const { codec: accepting } = codec();
  const both = await parseEpub(epub, limits, { codec: accepting });
  assert.deepEqual(
    both.images?.map((image) => image.sourcePath),
    ["OEBPS/images/first.png"],
  );
  assert.equal(both.imageWarnings[0].code, "edition-count-exceeded");

  const { codec: rejecting, calls } = codec([sha(first)]);
  const parsed = await parseEpub(epub, limits, { codec: rejecting });
  assert.deepEqual(
    parsed.images?.map((image) => image.sourcePath),
    ["OEBPS/images/second.png"],
  );
  assert.deepEqual(
    parsed.imageWarnings.map((warning) => [warning.sourcePath, warning.code]),
    [["OEBPS/images/first.png", "corrupt"]],
  );
  assert.deepEqual(calls, [sha(first), sha(second)], "each image normalized once");
});

test("identical bytes under two paths are normalized once and listed under each path", async () => {
  const same = encodePng({ width: 10, height: 5 });
  const epub = await illustrated([
    { href: "images/a.png", data: same },
    { href: "images/b.png", data: same },
  ]);
  const { codec: counting, calls } = codec();
  const parsed = await parseEpub(epub, {}, { codec: counting });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    parsed.images?.map((image) => [image.sourcePath, image.sha256]),
    [
      ["OEBPS/images/a.png", parsed.images?.[0].sha256],
      ["OEBPS/images/b.png", parsed.images?.[0].sha256],
    ],
  );
});

test("without a codec nothing is normalized and the result says so", async () => {
  const parsed = await parseEpub(
    await illustrated([{ href: "images/a.png", data: encodePng({ width: 4, height: 4 }) }]),
  );
  assert.equal(parsed.images, null);
  assert.ok(figures(parsed)[0].image, "the inspected image is still referenced by its figure");
});
