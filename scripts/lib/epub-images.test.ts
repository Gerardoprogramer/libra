import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import zlib from "node:zlib";

import {
  animatedWebp,
  encodePng,
  jpegWithOrientation,
  pngHeaderOnly,
  unsupportedImages,
  validJpeg,
  validWebp,
  validWebpAlpha,
} from "./epub-image-fixtures";
import {
  EditionImageBudget,
  IMAGE_LIMITS,
  inspectImage,
  normalizedSize,
  processImage,
  type ImageCodec,
  type ImageInspection,
  type ImageIssueCode,
} from "./epub-images";

// Image checks before any decoder: format by bytes, structure, dimensions and limits, and the processing contract
// that only a decoded, re-encoded and re-checked image is ever "ready". No image library, R2 or database is used.

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function rejects(data: Buffer, code: ImageIssueCode | ImageIssueCode[], pattern?: RegExp) {
  const result = await inspectImage(data);
  assert.equal(result.ok, false, `expected ${String(code)}`);
  if (result.ok) return;
  assert.ok([code].flat().includes(result.issue.code), `${result.issue.code}: ${result.issue.message}`);
  if (pattern) assert.match(result.issue.message, pattern);
}

async function accepts(data: Buffer): Promise<ImageInspection> {
  const result = await inspectImage(data);
  assert.ok(result.ok, result.ok ? "" : `${result.issue.code}: ${result.issue.message}`);
  return result.inspection;
}

test("valid JPEG, PNG and WebP images are accepted with their real format, size and transparency", async () => {
  const cases: [Buffer, Partial<ImageInspection>][] = [
    [validJpeg, { format: "jpeg", mediaType: "image/jpeg", width: 4, height: 3, hasAlpha: false, orientation: 1 }],
    [
      encodePng({ width: 5, height: 2 }),
      { format: "png", mediaType: "image/png", width: 5, height: 2, hasAlpha: false },
    ],
    [encodePng({ width: 3, height: 3, alpha: true }), { format: "png", width: 3, height: 3, hasAlpha: true }],
    [validWebp, { format: "webp", mediaType: "image/webp", width: 4, height: 3, hasAlpha: false }],
    [validWebpAlpha, { format: "webp", width: 4, height: 3, hasAlpha: true }],
  ];
  for (const [data, expected] of cases) {
    const inspection = await accepts(data);
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(inspection[field as keyof ImageInspection], value, `${expected.format} ${field}`);
    }
    assert.equal(inspection.bytes, data.length);
    assert.equal(inspection.sourceSha256, sha256(data));
  }
});

test("the EXIF orientation of a JPEG is read, and orientations 5–8 swap the normalized width and height", async () => {
  const rotated = await accepts(jpegWithOrientation(6));
  assert.equal(rotated.orientation, 6);
  assert.deepEqual(normalizedSize(rotated), { width: 3, height: 4 });
  assert.equal((await accepts(jpegWithOrientation(3))).orientation, 3);
  assert.deepEqual(normalizedSize(await accepts(jpegWithOrientation(3))), { width: 4, height: 3 });
});

test("unsupported formats are refused by their bytes, whatever they are called", async () => {
  await rejects(unsupportedImages.gif, "unsupported-format", /GIF/);
  await rejects(unsupportedImages.svg, "unsupported-format", /SVG/);
  await rejects(unsupportedImages.bmp, "unsupported-format", /BMP/);
  await rejects(unsupportedImages.text, "unsupported-format", /only JPEG, PNG and WebP/);
  await rejects(Buffer.alloc(0), "unsupported-format");
});

test("a file with a valid signature but a fake body is never taken for an image", async () => {
  const png = Buffer.concat([
    encodePng({ width: 1, height: 1 }).subarray(0, 8),
    Buffer.from("not really a png at all"),
  ]);
  const jpeg = Buffer.concat([validJpeg.subarray(0, 3), Buffer.from("fake jpeg body")]);
  const webp = Buffer.concat([Buffer.from("RIFF\x10\0\0\0WEBP", "latin1"), Buffer.from("junkjunk")]);
  for (const data of [png, jpeg, webp]) await rejects(data, ["corrupt", "truncated"]);
});

test("truncated files are refused, wherever they are cut", async () => {
  const png = encodePng({ width: 6, height: 4 });
  await rejects(png.subarray(0, png.length - 12), "truncated", /IEND/); // the IEND chunk is gone
  await rejects(png.subarray(0, 40), "truncated");
  await rejects(validJpeg.subarray(0, validJpeg.length - 2), "truncated", /end-of-image/);
  await rejects(validJpeg.subarray(0, 120), "truncated");
  await rejects(validWebp.subarray(0, validWebp.length - 10), "truncated");
  // Every chunk intact, but the compressed pixel stream stops early.
  const raw = Buffer.concat(Array.from({ length: 4 }, () => Buffer.from([0, ...Array(18).fill(9)])));
  const stream = zlib.deflateSync(raw);
  await rejects(encodePng({ width: 6, height: 4, pixelData: stream.subarray(0, stream.length - 6) }), [
    "truncated",
    "corrupt",
  ]);
});

test("PNG pixel data is checked completely: checksum, size and scanline filters", async () => {
  const png = encodePng({ width: 6, height: 4 });
  const flipped = Buffer.from(png);
  flipped[png.indexOf("IDAT") + 6] ^= 0xff;
  await rejects(flipped, "corrupt", /checksum/);

  const row = (filter: number) => Buffer.from([filter, ...Array(18).fill(1)]);
  await rejects(
    encodePng({ width: 6, height: 4, pixelData: zlib.deflateSync(Buffer.concat([row(0), row(0), row(0)])) }),
    "truncated",
    /dimensions need/,
  );
  await rejects(
    encodePng({
      width: 6,
      height: 4,
      pixelData: zlib.deflateSync(Buffer.concat([row(0), row(0), row(0), row(0), row(0)])),
    }),
    "corrupt",
    /larger/,
  );
  await rejects(
    encodePng({ width: 6, height: 4, pixelData: zlib.deflateSync(Buffer.concat([row(0), row(9), row(0), row(0)])) }),
    "corrupt",
    /filter/,
  );
  await rejects(encodePng({ width: 6, height: 4, pixelData: Buffer.from("not zlib") }), ["corrupt", "truncated"]);
});

test("animated images are refused", async () => {
  await rejects(animatedWebp(), "animated");
  const actl = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("acTL", "latin1"), Buffer.alloc(8)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(actl.subarray(4)));
  await rejects(encodePng({ width: 2, height: 2, extraChunks: [Buffer.concat([actl, crc])] }), "animated");
});

test("dimensions are limited by side and by pixels before any pixel is decompressed", async () => {
  await rejects(pngHeaderOnly(IMAGE_LIMITS.maxSide + 1, 1), "dimensions-too-large", /12000 pixels on a side/);
  await rejects(pngHeaderOnly(1, IMAGE_LIMITS.maxSide + 1), "dimensions-too-large");
  await rejects(pngHeaderOnly(8000, 7000), "too-many-pixels", /50000000/);
  await rejects(pngHeaderOnly(0, 5), "corrupt", /zero dimension/);
  // At the limit the header passes and the image is checked in full.
  const wide = await accepts(encodePng({ width: IMAGE_LIMITS.maxSide, height: 1 }));
  assert.equal(wide.width, 12_000);
});

test("a file over the size limit is refused before its bytes are read as an image", async () => {
  const big = Buffer.alloc(IMAGE_LIMITS.maxFileBytes + 1);
  encodePng({ width: 1, height: 1 }).copy(big);
  await rejects(big, "file-too-large", /10485760/);
  // At exactly the limit the same file is read (bytes after a PNG's IEND chunk are tolerated, as decoders do).
  assert.equal((await inspectImage(big.subarray(0, IMAGE_LIMITS.maxFileBytes))).ok, true);
});

test("normalized size keeps the proportion, never enlarges, and caps the width at 1600 px", async () => {
  const at = (width: number, height: number, orientation = 1) =>
    normalizedSize({ width, height, orientation } as ImageInspection);
  assert.deepEqual(at(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(at(1000, 500), { width: 1000, height: 500 });
  assert.deepEqual(at(1600, 9000), { width: 1600, height: 9000 });
  assert.deepEqual(at(3000, 4000, 6), { width: 1600, height: 1200 });
  assert.deepEqual(at(12_000, 1), { width: 1600, height: 1 });
});

test("the edition budget counts each image once, in order, and refuses only what exceeds it", () => {
  const budget = new EditionImageBudget({ ...IMAGE_LIMITS, maxImagesPerEdition: 2, maxEditionBytes: 100 });
  assert.equal(budget.admit("a.png", 40), null);
  assert.equal(budget.admit("a.png", 40), null); // the same image again costs nothing
  assert.equal(budget.admit("b.png", 70)?.code, "edition-bytes-exceeded");
  assert.equal(budget.admit("c.png", 60), null);
  assert.equal(budget.admit("d.png", 1)?.code, "edition-count-exceeded");
  assert.deepEqual(budget.used, { images: 2, bytes: 100 });
  // The defaults: 500 images and 150 MB per edition.
  assert.equal(IMAGE_LIMITS.maxImagesPerEdition, 500);
  assert.equal(IMAGE_LIMITS.maxEditionBytes, 150 * 1024 * 1024);
});

/* processImage: the codec is the decoder of the next phase; here stand-ins test the contract around it. */

function codec(id: string, normalize: ImageCodec["normalize"]): ImageCodec & { calls: number } {
  const wrapped = {
    id,
    calls: 0,
    normalize: (...args: Parameters<ImageCodec["normalize"]>) => {
      wrapped.calls++;
      return normalize(...args);
    },
  };
  return wrapped;
}

/** Writes a fresh PNG of exactly the requested size: what a real codec would do for a PNG source. */
const pngCodec = () => codec("test-png", async (_data, _inspection, target) => encodePng(target));

test("a processed image is ready only after the codec's output passes the same checks", async () => {
  const source = encodePng({ width: 4000, height: 3000 }); // a large valid image, smaller than the byte limit
  const result = await processImage("OEBPS/images/plate.png", source, pngCodec());

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1200);
  assert.equal(result.mediaType, "image/png");
  assert.equal(result.sourceSha256, sha256(source));
  assert.equal(result.sha256, sha256(result.data));
  assert.equal(result.key, `illustrations/${result.sha256}.png`);
  assert.equal(result.codec, "test-png");
  assert.equal(result.bytes, result.data.length);
});

test("identical normalized bytes give the identical key, whatever the source path", async () => {
  const source = encodePng({ width: 10, height: 10 });
  const [first, second] = await Promise.all([
    processImage("a/one.png", source, pngCodec()),
    processImage("b/two.png", source, pngCodec()),
  ]);
  assert.ok(first.status === "ready" && second.status === "ready");
  assert.equal(first.key, second.key);
  assert.notEqual(first.sourcePath, second.sourcePath);
});

test("an image the checks refuse never reaches the codec and is never ready", async () => {
  for (const data of [unsupportedImages.svg, validJpeg.subarray(0, 100), pngHeaderOnly(13_000, 2), animatedWebp()]) {
    const spy = pngCodec();
    const result = await processImage("OEBPS/x", data, spy);
    assert.equal(result.status, "rejected");
    assert.equal(spy.calls, 0);
    assert.ok(!("key" in result) && !("data" in result));
  }
});

test("a codec failure or a wrong output rejects the image with a structured reason", async () => {
  const source = encodePng({ width: 8, height: 8 });
  const cases: [ImageCodec, RegExp][] = [
    [codec("throws", async () => Promise.reject(new Error("VipsPng: libpng read error"))), /does not decode: VipsPng/],
    [codec("wrong-format", async () => validJpeg), /wrote jpeg, expected png/],
    [codec("wrong-size", async () => encodePng({ width: 4, height: 4 })), /is 4×4, expected 8×8/],
    [codec("garbage", async () => Buffer.from("garbage")), /normalized image is invalid/],
  ];
  for (const [failing, message] of cases) {
    const result = await processImage("OEBPS/p.png", source, failing);
    assert.equal(result.status, "rejected", failing.id);
    if (result.status === "rejected") {
      assert.equal(result.issue.code, "corrupt");
      assert.match(result.issue.message, message);
    }
  }
});

test("a codec that does not apply the orientation is caught by the size check", async () => {
  // The source is stored 4×3 with orientation 6, so it must come out 3×4; returning it untouched is refused.
  const result = await processImage(
    "OEBPS/r.jpg",
    jpegWithOrientation(6),
    codec("identity", async (data) => data),
  );
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.match(result.issue.message, /orientation|expected 3×4/);
});
