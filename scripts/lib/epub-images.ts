import { createHash } from "node:crypto";
import zlib from "node:zlib";

// Images of an EPUB, checked before anything decodes them. Everything here reads bytes only: the format comes from
// the magic bytes (never from the manifest or the file name), the structure of the file is walked within its bounds,
// and its dimensions are limited before a decoder ever sees it. PNG is verified completely here (every chunk CRC and
// the whole compressed pixel stream); JPEG and WebP are verified structurally and need the decoder of the processing
// step (ImageCodec) to prove they decode. An image is ready to publish only as a ProcessedImage with status "ready",
// which only processImage() produces, after a codec has decoded and re-encoded it.

const MB = 1024 * 1024;

export interface ImageLimits {
  /** Size of one original image file. */
  maxFileBytes: number;
  /** Original bytes of all the distinct images one edition uses. */
  maxEditionBytes: number;
  /** Distinct images one edition uses. */
  maxImagesPerEdition: number;
  /** Width or height of an original image. */
  maxSide: number;
  /** Width × height of an original image: bounds the memory a decoder needs (4 bytes per pixel ≈ 200 MB). */
  maxPixels: number;
  /** Width of a normalized image; smaller images are never enlarged. */
  maxNormalizedWidth: number;
}

export const IMAGE_LIMITS: ImageLimits = {
  maxFileBytes: 10 * MB,
  maxEditionBytes: 150 * MB,
  maxImagesPerEdition: 500,
  maxSide: 12_000,
  maxPixels: 50_000_000,
  maxNormalizedWidth: 1600,
};

export type ImageFormat = "jpeg" | "png" | "webp";

export const IMAGE_FORMATS: Record<
  ImageFormat,
  { mediaType: "image/jpeg" | "image/png" | "image/webp"; extension: string }
> = {
  jpeg: { mediaType: "image/jpeg", extension: "jpg" },
  png: { mediaType: "image/png", extension: "png" },
  webp: { mediaType: "image/webp", extension: "webp" },
};

export type ImageIssueCode =
  /** Not JPEG, PNG or WebP by its bytes (SVG, GIF, BMP, a renamed file…). */
  | "unsupported-format"
  /** The file ends before its structure does. */
  | "truncated"
  /** The structure is inconsistent: bad checksum, impossible header, pixel data that does not match, undecodable. */
  | "corrupt"
  | "animated"
  | "file-too-large"
  | "dimensions-too-large"
  | "too-many-pixels"
  | "edition-bytes-exceeded"
  | "edition-count-exceeded"
  /** The reference is not a path inside the EPUB (an URL, data:, a path leaving the archive). */
  | "outside-epub"
  /** The path is not declared as an image in the manifest. */
  | "undeclared"
  /** Declared or referenced, but absent from the archive. */
  | "missing";

/** Why an image cannot be used: a code to act on and a message to read. */
export interface ImageIssue {
  code: ImageIssueCode;
  message: string;
}

export interface ImageInspection {
  format: ImageFormat;
  mediaType: (typeof IMAGE_FORMATS)[ImageFormat]["mediaType"];
  /** As stored, before EXIF orientation. */
  width: number;
  height: number;
  /** EXIF orientation 1–8 (JPEG only; 1 elsewhere). 5–8 swap width and height when applied. */
  orientation: number;
  hasAlpha: boolean;
  bytes: number;
  /** SHA-256 of the original bytes: identifies the source, not what will be published. */
  sourceSha256: string;
}

export type InspectionResult = { ok: true; inspection: ImageInspection } | { ok: false; issue: ImageIssue };

const issue = (code: ImageIssueCode, message: string): { ok: false; issue: ImageIssue } => ({
  ok: false,
  issue: { code, message },
});

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The format a file's magic bytes declare, or null for anything else. */
export function detectImageFormat(data: Buffer): ImageFormat | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

function describeUnsupported(data: Buffer) {
  const head = data.subarray(0, 64).toString("latin1");
  if (/^GIF8[79]a/.test(head)) return "a GIF image";
  if (/^BM/.test(head)) return "a BMP image";
  if (/<svg[\s>]|<\?xml/i.test(head)) return "SVG or XML";
  return "not a JPEG, PNG or WebP image";
}

/* PNG: chunk structure with CRCs, a valid IHDR, and a compressed pixel stream that inflates to exactly the size the
   header implies, with a valid filter byte on every scanline. */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_CHANNELS: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
};
// Adam7 passes: x start, y start, x step, y step.
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/** Scanline lengths (filter byte included) of the decompressed pixel stream, in order. */
function* pngScanlines(width: number, height: number, bitsPerPixel: number, interlaced: boolean) {
  const passes = interlaced ? ADAM7 : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = width > x0 ? Math.ceil((width - x0) / dx) : 0;
    const passHeight = height > y0 ? Math.ceil((height - y0) / dy) : 0;
    if (!passWidth || !passHeight) continue;
    const length = 1 + Math.ceil((passWidth * bitsPerPixel) / 8);
    for (let row = 0; row < passHeight; row++) yield length;
  }
}

function checkPngPixels(
  compressed: Buffer,
  width: number,
  height: number,
  bitsPerPixel: number,
  interlaced: boolean,
): Promise<ImageIssue | null> {
  const lines = pngScanlines(width, height, bitsPerPixel, interlaced);
  let expected = 0;
  for (const length of pngScanlines(width, height, bitsPerPixel, interlaced)) expected += length;

  return new Promise((resolve) => {
    // Streamed, never held whole: only the running position and the next filter byte are tracked.
    const inflate = zlib.createInflate();
    let total = 0;
    let nextFilterAt = 0;
    let current = lines.next();
    let settled = false;
    const finish = (result: ImageIssue | null) => {
      if (settled) return;
      settled = true;
      inflate.destroy();
      resolve(result);
    };

    inflate.on("data", (chunk: Buffer) => {
      if (total + chunk.length > expected) {
        finish({ code: "corrupt", message: "PNG pixel data is larger than its dimensions allow" });
        return;
      }
      while (!current.done && nextFilterAt < total + chunk.length) {
        if (chunk[nextFilterAt - total] > 4) {
          finish({
            code: "corrupt",
            message: `PNG scanline has an invalid filter type ${chunk[nextFilterAt - total]}`,
          });
          return;
        }
        nextFilterAt += current.value;
        current = lines.next();
      }
      total += chunk.length;
    });
    inflate.on("error", (error) =>
      finish({
        code: /unexpected end/i.test(error.message) ? "truncated" : "corrupt",
        message: `PNG pixel data does not decompress: ${error.message}`,
      }),
    );
    inflate.on("end", () =>
      finish(
        total === expected
          ? null
          : { code: "truncated", message: `PNG pixel data is ${total} bytes, its dimensions need ${expected}` },
      ),
    );
    inflate.end(compressed);
  });
}

async function inspectPng(data: Buffer, limits: ImageLimits): Promise<InspectionResult> {
  let offset = 8;
  let header: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  let palette = false;
  let transparency = false;
  let ended = false;
  const idat: Buffer[] = [];

  while (offset < data.length && !ended) {
    if (offset + 8 > data.length) return issue("truncated", "PNG ends inside a chunk header");
    const length = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (length > 0x7fffffff) return issue("corrupt", `PNG chunk ${type} declares an impossible length`);
    if (end > data.length) return issue("truncated", `PNG ends inside its ${type} chunk`);
    if (zlib.crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(offset + 8 + length)) {
      return issue("corrupt", `PNG chunk ${type} fails its checksum`);
    }
    const body = data.subarray(offset + 8, offset + 8 + length);

    if (!header && type !== "IHDR") return issue("corrupt", "PNG does not start with its IHDR chunk");
    if (type === "IHDR") {
      if (header || length !== 13) return issue("corrupt", "PNG has an invalid IHDR chunk");
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
      const kind = PNG_CHANNELS[header.colorType];
      if (!kind || !kind.depths.includes(header.bitDepth) || body[10] !== 0 || body[11] !== 0 || header.interlace > 1) {
        return issue("corrupt", "PNG header declares an invalid pixel format");
      }
      const limited = checkDimensions(header.width, header.height, limits);
      if (limited) return limited;
    } else if (type === "PLTE") palette = true;
    else if (type === "tRNS") transparency = true;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") ended = true;
    else if (type === "acTL") return issue("animated", "animated PNG (APNG) images are not supported");
    offset = end;
  }

  if (!header) return issue("truncated", "PNG has no IHDR chunk");
  if (!ended) return issue("truncated", "PNG has no IEND chunk");
  if (!idat.length) return issue("corrupt", "PNG has no pixel data");
  if (header.colorType === 3 && !palette) return issue("corrupt", "indexed PNG has no palette");

  const kind = PNG_CHANNELS[header.colorType];
  const pixels = await checkPngPixels(
    Buffer.concat(idat),
    header.width,
    header.height,
    kind.channels * header.bitDepth,
    header.interlace === 1,
  );
  if (pixels) return { ok: false, issue: pixels };

  return inspected("png", data, header.width, header.height, {
    hasAlpha: header.colorType === 4 || header.colorType === 6 || transparency,
  });
}

/* JPEG: the marker segments up to the first scan, a frame header with the dimensions, the EXIF orientation, and the
   end-of-image marker that a complete file ends with. The entropy-coded scan itself needs the codec. */

function exifOrientation(segment: Buffer): number {
  if (segment.length < 14 || segment.toString("latin1", 0, 6) !== "Exif\0\0") return 1;
  const tiff = segment.subarray(6);
  const little = tiff.toString("latin1", 0, 2) === "II";
  if (!little && tiff.toString("latin1", 0, 2) !== "MM") return 1;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (tiff.length < 8 || u16(2) !== 42) return 1;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const entries = u16(ifd);
  for (let index = 0; index < entries; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function inspectJpeg(data: Buffer, limits: ImageLimits): InspectionResult {
  let offset = 2;
  let size: { width: number; height: number } | null = null;
  let orientation = 1;

  while (true) {
    if (offset >= data.length) return issue("truncated", "JPEG ends before its first scan");
    if (data[offset] !== 0xff) return issue("corrupt", "JPEG marker segments are out of sync");
    while (data[offset] === 0xff) offset++;
    if (offset >= data.length) return issue("truncated", "JPEG ends inside a marker");
    const marker = data[offset++];
    if (marker === 0xd8 || marker === 0xd9) return issue("corrupt", "JPEG has an image boundary before its first scan");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) return issue("truncated", "JPEG ends inside a segment length");
    const length = data.readUInt16BE(offset);
    if (length < 2) return issue("corrupt", "JPEG segment declares an impossible length");
    if (offset + length > data.length) return issue("truncated", "JPEG ends inside a segment");
    const segment = data.subarray(offset + 2, offset + length);

    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (segment.length < 6) return issue("corrupt", "JPEG frame header is too short");
      size = { height: segment.readUInt16BE(1), width: segment.readUInt16BE(3) };
    } else if (marker === 0xe1 && orientation === 1) {
      orientation = exifOrientation(segment);
    } else if (marker === 0xda) {
      if (!size) return issue("corrupt", "JPEG scan starts before its frame header");
      break;
    }
    offset += length;
  }
  if (!size) return issue("corrupt", "JPEG has no frame header");

  // A complete JPEG ends with its end-of-image marker (some writers pad after it).
  let end = data.length;
  while (end > 2 && data[end - 1] === 0x00) end--;
  if (data[end - 2] !== 0xff || data[end - 1] !== 0xd9) return issue("truncated", "JPEG has no end-of-image marker");

  const limited = checkDimensions(size.width, size.height, limits);
  if (limited) return limited;
  return inspected("jpeg", data, size.width, size.height, { orientation, hasAlpha: false });
}

/* WebP: the RIFF container and its chunks within bounds, the dimensions of its VP8, VP8L or VP8X header, no
   animation. The VP8/VP8L bitstream itself needs the codec. */

function inspectWebp(data: Buffer, limits: ImageLimits): InspectionResult {
  const riffEnd = 8 + data.readUInt32LE(4);
  if (riffEnd > data.length) return issue("truncated", "WebP ends before its RIFF container does");
  let offset = 12;
  let size: { width: number; height: number } | null = null;
  let hasAlpha = false;
  let image = false;

  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) return issue("truncated", "WebP ends inside a chunk header");
    const type = data.toString("latin1", offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > riffEnd) return issue("truncated", `WebP ends inside its ${type.trim()} chunk`);
    const body = data.subarray(offset + 8, end);

    if (type === "VP8X") {
      if (length < 10) return issue("corrupt", "WebP VP8X chunk is too short");
      if (body[0] & 0x02) return issue("animated", "animated WebP images are not supported");
      hasAlpha = Boolean(body[0] & 0x10);
      size = { width: 1 + body.readUIntLE(4, 3), height: 1 + body.readUIntLE(7, 3) };
    } else if (type === "ANIM" || type === "ANMF") {
      return issue("animated", "animated WebP images are not supported");
    } else if (type === "VP8 ") {
      if (length < 10 || body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a) {
        return issue("corrupt", "WebP VP8 frame header is invalid");
      }
      size ??= { width: body.readUInt16LE(6) & 0x3fff, height: body.readUInt16LE(8) & 0x3fff };
      image = true;
    } else if (type === "VP8L") {
      if (length < 5 || body[0] !== 0x2f) return issue("corrupt", "WebP VP8L header is invalid");
      const bits = body.readUInt32LE(1);
      size ??= { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      hasAlpha ||= Boolean((bits >> 28) & 1);
      image = true;
    }
    offset = end + (length % 2);
  }

  if (!image || !size) return issue("corrupt", "WebP has no image data");
  const limited = checkDimensions(size.width, size.height, limits);
  if (limited) return limited;
  return inspected("webp", data, size.width, size.height, { hasAlpha });
}

function checkDimensions(width: number, height: number, limits: ImageLimits): { ok: false; issue: ImageIssue } | null {
  if (!width || !height) return issue("corrupt", "image declares a zero dimension");
  if (width > limits.maxSide || height > limits.maxSide) {
    return issue("dimensions-too-large", `${width}×${height} exceeds ${limits.maxSide} pixels on a side`);
  }
  if (width * height > limits.maxPixels) {
    return issue("too-many-pixels", `${width}×${height} exceeds ${limits.maxPixels} pixels`);
  }
  return null;
}

function inspected(
  format: ImageFormat,
  data: Buffer,
  width: number,
  height: number,
  { orientation = 1, hasAlpha }: { orientation?: number; hasAlpha: boolean },
): InspectionResult {
  return {
    ok: true,
    inspection: {
      format,
      mediaType: IMAGE_FORMATS[format].mediaType,
      width,
      height,
      orientation,
      hasAlpha,
      bytes: data.length,
      sourceSha256: sha256(data),
    },
  };
}

/** Checks one image file without decoding it: size, format by bytes, structure, dimensions (see the module header). */
export async function inspectImage(data: Buffer, limits: ImageLimits = IMAGE_LIMITS): Promise<InspectionResult> {
  if (data.length > limits.maxFileBytes) {
    return issue("file-too-large", `${data.length} bytes exceeds ${limits.maxFileBytes}`);
  }
  const format = detectImageFormat(data);
  if (!format) return issue("unsupported-format", `${describeUnsupported(data)}; only JPEG, PNG and WebP are accepted`);
  try {
    if (format === "png") return await inspectPng(data, limits);
    if (format === "jpeg") return inspectJpeg(data, limits);
    return inspectWebp(data, limits);
  } catch (error) {
    // Reading past a bound always means the file is shorter than its structure says.
    if (error instanceof RangeError) return issue("truncated", `${format.toUpperCase()} ends unexpectedly`);
    throw error;
  }
}

/** The size an image will have once oriented and, if wider than allowed, scaled down to the maximum width. */
export function normalizedSize(inspection: ImageInspection, maxWidth = IMAGE_LIMITS.maxNormalizedWidth) {
  const swapped = inspection.orientation >= 5;
  const width = swapped ? inspection.height : inspection.width;
  const height = swapped ? inspection.width : inspection.height;
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/**
 * Per-edition allowance: distinct images (by archive path) count once, in the order the text uses them, against the
 * number and total-bytes limits. An image past either limit is refused, never the ones before it.
 */
export class EditionImageBudget {
  private readonly admitted = new Set<string>();
  private bytes = 0;

  constructor(private readonly limits: ImageLimits = IMAGE_LIMITS) {}

  admit(path: string, bytes: number): ImageIssue | null {
    if (this.admitted.has(path)) return null;
    if (this.admitted.size >= this.limits.maxImagesPerEdition) {
      return {
        code: "edition-count-exceeded",
        message: `the edition already uses ${this.limits.maxImagesPerEdition} images`,
      };
    }
    if (this.bytes + bytes > this.limits.maxEditionBytes) {
      return {
        code: "edition-bytes-exceeded",
        message: `${this.bytes + bytes} bytes of images exceeds ${this.limits.maxEditionBytes} for one edition`,
      };
    }
    this.admitted.add(path);
    this.bytes += bytes;
    return null;
  }

  get used() {
    return { images: this.admitted.size, bytes: this.bytes };
  }
}

/**
 * The decoder that proves an image decodes and re-encodes it: oriented, metadata stripped, scaled to `target`, in
 * `target.format`. Implemented with sharp in the processing phase; it is only ever given images inspectImage accepted.
 */
export interface ImageCodec {
  /** Name and settings, recorded with each result: the same input gives the same bytes only with the same codec. */
  readonly id: string;
  normalize(
    data: Buffer,
    inspection: ImageInspection,
    target: { width: number; height: number; format: ImageFormat },
  ): Promise<Buffer>;
}

export type ProcessedImage =
  | {
      status: "ready";
      sourcePath: string;
      sourceSha256: string;
      /** SHA-256 of the normalized bytes: identical output, identical key, stored once. */
      sha256: string;
      /** Proposed object key; nothing is uploaded here. */
      key: string;
      mediaType: ImageInspection["mediaType"];
      width: number;
      height: number;
      bytes: number;
      codec: string;
      data: Buffer;
    }
  | { status: "rejected"; sourcePath: string; issue: ImageIssue };

/**
 * Inspects, normalizes with the codec and checks the codec's output (format, structure, dimensions) before calling an
 * image ready. The output keeps the source format, so PNG and WebP keep their transparency.
 */
export async function processImage(
  sourcePath: string,
  data: Buffer,
  codec: ImageCodec,
  limits: ImageLimits = IMAGE_LIMITS,
): Promise<ProcessedImage> {
  const rejected = (problem: ImageIssue): ProcessedImage => ({ status: "rejected", sourcePath, issue: problem });

  const inspected = await inspectImage(data, limits);
  if (!inspected.ok) return rejected(inspected.issue);
  const { inspection } = inspected;
  const target = { ...normalizedSize(inspection, limits.maxNormalizedWidth), format: inspection.format };

  let output: Buffer;
  try {
    output = await codec.normalize(data, inspection, target);
  } catch (error) {
    return rejected({
      code: "corrupt",
      message: `${inspection.format.toUpperCase()} does not decode: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    });
  }

  const checked = await inspectImage(output, { ...limits, maxFileBytes: Infinity });
  if (!checked.ok)
    return rejected({ code: "corrupt", message: `the normalized image is invalid: ${checked.issue.message}` });
  const result = checked.inspection;
  if (result.format !== target.format) {
    return rejected({ code: "corrupt", message: `the codec wrote ${result.format}, expected ${target.format}` });
  }
  if (result.orientation !== 1)
    return rejected({ code: "corrupt", message: "the normalized image still has an orientation" });
  // Scaling may round the derived side by one pixel.
  if (result.width !== target.width || Math.abs(result.height - target.height) > 1) {
    return rejected({
      code: "corrupt",
      message: `the normalized image is ${result.width}×${result.height}, expected ${target.width}×${target.height}`,
    });
  }

  const digest = sha256(output);
  return {
    status: "ready",
    sourcePath,
    sourceSha256: inspection.sourceSha256,
    sha256: digest,
    key: `illustrations/${digest}.${IMAGE_FORMATS[result.format].extension}`,
    mediaType: result.mediaType,
    width: result.width,
    height: result.height,
    bytes: output.length,
    codec: codec.id,
    data: output,
  };
}
