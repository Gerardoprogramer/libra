import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import sharp from "sharp";

import {
  addExifOrientation,
  animatedWebp,
  encodePng,
  jpegWithOrientation,
  unsupportedImages,
  validJpeg,
  validWebp,
  validWebpAlpha,
} from "./epub-image-fixtures";
import { IMAGE_LIMITS, inspectImage, processImage, type ImageCodec, type ProcessedImage } from "./epub-images";
import {
  createSharpCodec,
  SHARP_BYTE_LIBRARIES,
  SHARP_ENCODING,
  SHARP_PIPELINE,
  SHARP_SETTINGS_VERSION,
  sharpCodecId,
} from "./sharp-codec";

// The real codec (sharp/libvips): images decoded in full and re-encoded, then checked by the same inspection as any
// input. Assertions read the output back (format, size, pixels, metadata) instead of comparing whole files, so a
// different but correct encoder build does not break them. No R2, database or network.

const codec = createSharpCodec();
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function ready(data: Buffer, path = "OEBPS/image") {
  const result = await processImage(path, data, codec);
  assert.equal(
    result.status,
    "ready",
    result.status === "rejected" ? `${result.issue.code}: ${result.issue.message}` : "",
  );
  return result as Extract<ProcessedImage, { status: "ready" }>;
}

async function rejected(data: Buffer, pattern?: RegExp, with_ = codec) {
  const result = await processImage("OEBPS/image", data, with_);
  assert.equal(result.status, "rejected");
  assert.ok(!("key" in result) && !("data" in result) && !("sha256" in result));
  if (pattern && result.status === "rejected") assert.match(result.issue.message, pattern);
  return result as Extract<ProcessedImage, { status: "rejected" }>;
}

/** Deterministic noise, so encoders have real content to compress. */
function noise(width: number, height: number, channels: 1 | 3 | 4) {
  const data = Buffer.alloc(width * height * channels);
  let seed = 7;
  for (let index = 0; index < data.length; index++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[index] = seed >> 16;
  }
  if (channels === 4) for (let index = 3; index < data.length; index += 4) data[index] = 128; // half transparent
  return sharp(data, { raw: { width, height, channels } });
}

async function pixel(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(at, at + info.channels));
}

test("valid JPEG, PNG and WebP images are decoded, re-encoded in their format and pass inspection again", async () => {
  for (const [source, format] of [
    [validJpeg, "jpeg"],
    [encodePng({ width: 5, height: 4 }), "png"],
    [validWebp, "webp"],
    [await noise(40, 30, 3).jpeg({ quality: 95 }).toBuffer(), "jpeg"],
  ] as const) {
    const result = await ready(source);
    const output = await inspectImage(result.data);
    assert.ok(output.ok);
    assert.equal(output.inspection.format, format);
    assert.equal(result.mediaType, `image/${format}`);
    assert.equal((await sharp(result.data).metadata()).format, format);
    assert.equal(result.sha256, sha256(result.data));
    assert.equal(result.key, `illustrations/${result.sha256}.${format === "jpeg" ? "jpg" : format}`);
    assert.equal(result.bytes, result.data.length);
  }
});

test("PNG and WebP keep their transparency", async () => {
  for (const source of [
    await noise(40, 30, 4).png().toBuffer(),
    await noise(40, 30, 4).webp({ lossless: true }).toBuffer(),
    validWebpAlpha,
  ]) {
    const result = await ready(source);
    const metadata = await sharp(result.data).metadata();
    assert.equal(metadata.hasAlpha, true, metadata.format);
    assert.equal(metadata.channels, 4);
  }
  // The half-transparent pixels stay half transparent.
  const png = await ready(await noise(40, 30, 4).png().toBuffer());
  assert.equal((await pixel(png.data, 3, 3))[3], 128);
});

test("EXIF orientation is applied to the pixels, and orientations 5–8 swap width and height", async () => {
  // 4×2, left half red and right half blue.
  const raw = Buffer.alloc(4 * 2 * 3);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) raw.set(x < 2 ? [255, 0, 0] : [0, 0, 255], (y * 4 + x) * 3);
  const halves = await sharp(raw, { raw: { width: 4, height: 2, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  const red = (rgb: number[]) => rgb[0] > 200 && rgb[2] < 60;
  const blue = (rgb: number[]) => rgb[2] > 200 && rgb[0] < 60;

  for (let orientation = 1; orientation <= 8; orientation++) {
    const result = await ready(addExifOrientation(halves, orientation));
    const swapped = orientation >= 5;
    assert.deepEqual([result.width, result.height], swapped ? [2, 4] : [4, 2], `orientation ${orientation}`);
    assert.equal((await sharp(result.data).metadata()).orientation, undefined, `orientation ${orientation} written`);
  }
  // Displayed as intended: 6 turns the left (red) half to the top, 8 to the bottom, 3 to the right.
  const top = async (orientation: number) => pixel((await ready(addExifOrientation(halves, orientation))).data, 0, 0);
  assert.ok(red(await top(1)));
  assert.ok(blue(await top(3)));
  assert.ok(red(await top(6)));
  assert.ok(blue(await top(8)));
});

test("files damaged inside their data, which pass the structural inspection, are rejected by the decoder", async () => {
  const jpeg = await noise(64, 48, 3).jpeg({ quality: 90 }).toBuffer();
  const scan = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  // Cut in the middle of the scan, with the end-of-image marker put back: the structure looks complete.
  const cut = Buffer.concat([jpeg.subarray(0, scan + 200), Buffer.from([0xff, 0xd9])]);
  assert.ok((await inspectImage(cut)).ok);
  await rejected(cut, /JPEG does not decode: .*(premature end|Corrupt JPEG)/);

  const lossless = await noise(64, 48, 4).webp({ lossless: true }).toBuffer();
  const garbled = Buffer.from(lossless);
  for (let index = 40; index < garbled.length - 8; index++) garbled[index] ^= 0xa5;
  assert.ok((await inspectImage(garbled)).ok);
  await rejected(garbled, /WEBP does not decode/);

  // Damage the inspection catches never reaches the decoder.
  await rejected(jpeg.subarray(0, scan + 200), /no end-of-image marker/);
});

test("animated images and forbidden formats are refused before the codec runs", async () => {
  let calls = 0;
  const counting: ImageCodec = {
    id: codec.id,
    normalize: (...args) => {
      calls++;
      return codec.normalize(...args);
    },
  };
  for (const data of [animatedWebp(), unsupportedImages.svg, unsupportedImages.gif, unsupportedImages.bmp]) {
    await rejected(data, undefined, counting);
  }
  assert.equal(calls, 0);
});

test("the codec itself refuses bytes that are not the format it was told, so SVG never reaches libvips", async () => {
  const inspected = await inspectImage(encodePng({ width: 10, height: 10 }));
  assert.ok(inspected.ok);
  await assert.rejects(
    codec.normalize(unsupportedImages.svg, inspected.inspection, { width: 10, height: 10, format: "png" }),
    /not the inspected png/,
  );
  // A header that lies about the size is caught against the decoder's own reading.
  const lying = { ...inspected.inspection, width: 20 };
  await assert.rejects(
    codec.normalize(encodePng({ width: 10, height: 10 }), lying, { width: 20, height: 10, format: "png" }),
    /decoder reads 10×10, inspected as 20×10/,
  );
});

test("images are scaled down to 1600 px wide in proportion, never enlarged", async () => {
  const wide = await ready(await noise(2400, 1200, 4).png().toBuffer());
  assert.deepEqual([wide.width, wide.height], [1600, 800]);
  const narrow = await ready(await noise(1000, 500, 3).jpeg().toBuffer());
  assert.deepEqual([narrow.width, narrow.height], [1000, 500]);
  const tall = await ready(await noise(1200, 3000, 3).webp().toBuffer());
  assert.deepEqual([tall.width, tall.height], [1200, 3000]);
  const tiny = await ready(encodePng({ width: 1, height: 1 }));
  assert.deepEqual([tiny.width, tiny.height], [1, 1]);
  // At the side limit: 12000×1 becomes 1600×1.
  const strip = await ready(encodePng({ width: IMAGE_LIMITS.maxSide, height: 1 }));
  assert.deepEqual([strip.width, strip.height], [1600, 1]);
  for (const result of [wide, narrow, tall, strip]) {
    const metadata = await sharp(result.data).metadata();
    assert.deepEqual([metadata.width, metadata.height], [result.width, result.height]);
  }
});

test("the decoder enforces the pixel limit itself, whatever the header said", async () => {
  const small = createSharpCodec({ ...IMAGE_LIMITS, maxPixels: 1000 });
  const data = encodePng({ width: 40, height: 40 });
  const inspected = await inspectImage(data); // inspected with the default limits: 1600 pixels is fine there
  assert.ok(inspected.ok);
  await assert.rejects(
    small.normalize(data, inspected.inspection, { width: 40, height: 40, format: "png" }),
    /pixel limit/i,
  );
});

test("metadata is stripped and colour is converted to sRGB", async () => {
  const p3 = await noise(32, 24, 3)
    .withIccProfile("p3")
    .withExif({ IFD0: { Copyright: "Someone", Software: "Camera" } })
    .jpeg()
    .toBuffer();
  const input = await sharp(p3).metadata();
  assert.ok(input.icc && input.exif);

  const cmyk = await noise(32, 24, 3).toColourspace("cmyk").jpeg().toBuffer();
  assert.equal((await sharp(cmyk).metadata()).space, "cmyk");

  const sixteenBit = await noise(20, 10, 3).toColourspace("rgb16").png().toBuffer();
  assert.equal((await sharp(sixteenBit).metadata()).depth, "ushort");

  for (const source of [p3, cmyk, sixteenBit, jpegWithOrientation(6)]) {
    const result = await ready(source);
    const metadata = await sharp(result.data).metadata();
    assert.equal(metadata.space, "srgb");
    assert.equal(metadata.depth, "uchar");
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.iptc, undefined);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.channels, 3);
  }
});

test("the same source gives the same bytes and key, and the codec id names the encoder and its settings", async () => {
  const source = await noise(300, 200, 3).jpeg({ quality: 95 }).toBuffer();
  const [first, second] = [await ready(source, "a.jpg"), await ready(source, "b.jpg")];
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.key, second.key);
  assert.ok(first.data.equals(second.data));
  assert.equal(first.codec, codec.id);
  assert.equal(SHARP_ENCODING.jpeg.quality, 82);

  // The installed build: sharp, libvips and every encoding library at its reported version, the platform, the SIMD
  // state and the settings.
  const { versions } = sharp;
  assert.match(
    codec.id,
    new RegExp(
      `^sharp@${versions.sharp}/libvips@${versions.vips}/mozjpeg@${versions.mozjpeg}/png@${versions.png}/` +
        `zlib-ng@${versions["zlib-ng"]}/webp@${versions.webp}/lcms@${versions.lcms}/exif@${versions.exif}/` +
        `highway@${versions.highway}/[a-z0-9]+-[a-z0-9]+/(no)?simd/settings-v${SHARP_SETTINGS_VERSION}\\.[0-9a-f]{12}$`,
    ),
  );
  assert.ok(codec.id.length <= 200);
});

test("the codec id changes with any library version, the platform, SIMD and every setting", () => {
  const input = {
    versions: { sharp: "0.35.5", ...Object.fromEntries(SHARP_BYTE_LIBRARIES.map((name) => [name, "1.0.0"])) },
    platform: "linux-x64",
    simd: true,
  };
  const base = sharpCodecId(input);
  assert.equal(base, sharpCodecId(structuredClone(input)), "the same build gives the same id");
  assert.match(
    base,
    /^sharp@0\.35\.5\/libvips@1\.0\.0\/mozjpeg@1\.0\.0\/.*\/linux-x64\/simd\/settings-v2\.[0-9a-f]{12}$/,
  );

  const variants = [
    ...["sharp", ...SHARP_BYTE_LIBRARIES].map((name) =>
      sharpCodecId({ ...input, versions: { ...input.versions, [name]: "1.0.1" } }),
    ),
    sharpCodecId({ ...input, platform: "linuxmusl-x64" }),
    sharpCodecId({ ...input, simd: false }),
    sharpCodecId({ ...input, settingsVersion: SHARP_SETTINGS_VERSION + 1 }),
    sharpCodecId({
      ...input,
      settings: {
        pipeline: SHARP_PIPELINE,
        encoding: { ...SHARP_ENCODING, webp: { ...SHARP_ENCODING.webp, quality: 80 } },
      },
    }),
    sharpCodecId({
      ...input,
      settings: {
        pipeline: { ...SHARP_PIPELINE, resize: { ...SHARP_PIPELINE.resize, kernel: "mitchell" } },
        encoding: SHARP_ENCODING,
      },
    }),
  ];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1);
  // Versions the id does not depend on (formats the codec never reads or writes) do not change it.
  assert.equal(sharpCodecId({ ...input, versions: { ...input.versions, heif: "9.9.9", rsvg: "9.9.9" } }), base);
});

test("an incomplete or malformed build is refused instead of giving a partial codec id", () => {
  const versions = { sharp: "0.35.5", ...Object.fromEntries(SHARP_BYTE_LIBRARIES.map((name) => [name, "1.0.0"])) };
  const input = { versions, platform: "win32-x64", simd: true };

  // A globally installed libvips: sharp reports only its own version and libvips', not the codecs.
  assert.throws(
    () => sharpCodecId({ ...input, versions: { sharp: "0.35.5", vips: "8.18.7" } }),
    /mozjpeg is not reported.*globally installed libvips/,
  );
  for (const name of ["sharp", ...SHARP_BYTE_LIBRARIES]) {
    const rest: Record<string, string> = { ...versions };
    delete rest[name];
    assert.throws(() => sharpCodecId({ ...input, versions: rest }), new RegExp(`${name} is not reported`), name);
  }
  for (const value of ["", "1.0/2", "1@2", " 1.0", "x".repeat(41)]) {
    assert.throws(() => sharpCodecId({ ...input, versions: { ...versions, png: value } }), /png is malformed/, value);
  }
  assert.throws(() => sharpCodecId({ ...input, platform: "" }), /platform is malformed/);
  assert.throws(
    () =>
      sharpCodecId({
        ...input,
        versions: Object.fromEntries(Object.keys(versions).map((name) => [name, "9".repeat(30)])),
      }),
    /longer than 200 characters/,
  );
});

test("a decode or encode failure, or damaged output, never leaves a ready image", async () => {
  // Damaged output: the real codec's bytes, cut short.
  const truncating: ImageCodec = {
    id: "truncating",
    normalize: async (...args) => (await codec.normalize(...args)).subarray(0, 50),
  };
  await rejected(encodePng({ width: 30, height: 20 }), /normalized image is invalid/, truncating);

  // An encoder the codec does not have.
  const unknownFormat: ImageCodec = {
    id: "unknown-format",
    normalize: (data, inspection, target) =>
      codec.normalize(data, inspection, { ...target, format: "gif" as typeof target.format }),
  };
  await rejected(validJpeg, /does not decode/, unknownFormat);

  // Output of the wrong size from the real encoder.
  const wrongSize: ImageCodec = {
    id: "wrong-size",
    normalize: (data, inspection, target) => codec.normalize(data, inspection, { ...target, width: target.width - 1 }),
  };
  await rejected(await noise(40, 30, 3).png().toBuffer(), /expected 40×30/, wrongSize);
});
