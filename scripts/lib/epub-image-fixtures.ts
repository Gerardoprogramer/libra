import zlib from "node:zlib";

// Image files for the image checks: valid ones in each accepted format and damaged, disguised, unsupported or
// oversized ones. PNG is encoded here; the JPEG and WebP files were written once by sharp 0.35.5 (libvips 8.18.7) as a
// 4×3 red image and are embedded as bytes, so the tests need no image library.

export const validJpeg = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKAAK2/9k=",
  "base64",
);

/** Lossy WebP (VP8), 4×3. */
export const validWebp = Buffer.from(
  "UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoEAAMAAUAmJaACdLoAA5gA/vCbQ/4DdfFtMv/ucD/uyf/2yf+pAAAA",
  "base64",
);

/** Lossless WebP (VP8L) with an alpha channel, 4×3. */
export const validWebpAlpha = Buffer.from("UklGRhoAAABXRUJQVlA4TA4AAAAvA4AAEAcQEQUMRET/Aw==", "base64");

function chunk(type: string, body: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A valid, decodable PNG: 8-bit RGB (colorType 2) or RGBA (6), every scanline with filter type 0. `pixelData`
 * replaces the compressed stream (to damage it) and `extraChunks` are written before IDAT.
 */
export function encodePng({
  width,
  height,
  alpha = false,
  pixelData,
  extraChunks = [],
}: {
  width: number;
  height: number;
  alpha?: boolean;
  pixelData?: Buffer;
  extraChunks?: Buffer[];
}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  const row = Buffer.alloc(1 + width * (alpha ? 4 : 3), 0x7f);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...extraChunks,
    chunk("IDAT", pixelData ?? zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A PNG whose header claims `width`×`height` but carries one byte of pixel data: rejected before inflating. */
export function pngHeaderOnly(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The 4×3 JPEG with an EXIF APP1 segment that sets `orientation` (6 = rotate 90° clockwise to display). */
export function jpegWithOrientation(orientation: number) {
  return addExifOrientation(validJpeg, orientation);
}

/** Any JPEG with an EXIF APP1 segment, right after its start marker, that sets `orientation`. */
export function addExifOrientation(jpeg: Buffer, orientation: number) {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 right after the header
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22); // no next IFD
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), segment, body, jpeg.subarray(2)]);
}

/** A WebP container declaring an animation (VP8X with its animation flag, then ANIM): never decoded. */
export function animatedWebp() {
  const vp8x = Buffer.alloc(18);
  vp8x.write("VP8X", 0, "latin1");
  vp8x.writeUInt32LE(10, 4);
  vp8x[8] = 0x02; // animation
  vp8x.writeUIntLE(3, 12, 3); // canvas 4×3
  vp8x.writeUIntLE(2, 15, 3);
  const anim = Buffer.alloc(14);
  anim.write("ANIM", 0, "latin1");
  anim.writeUInt32LE(6, 4);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), vp8x, anim]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export const unsupportedImages = {
  gif: Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'),
  bmp: Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(60)]),
  text: Buffer.from("This is not an image at all."),
};
