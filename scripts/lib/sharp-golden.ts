import zlib from "node:zlib";

// Golden inputs for the sharp environment check: one image per accepted format, chosen to go through every step that
// shapes the normalized bytes. The JPEG is decoded and re-encoded by mozjpeg after its EXIF orientation (6) is applied
// and its Display P3 ICC profile is converted to sRGB (lcms, libexif); the WebP keeps its alpha through libwebp; the
// PNG is wider than IMAGE_LIMITS.maxNormalizedWidth, so it is resampled (libvips, highway) and recompressed (libpng,
// zlib-ng). The JPEG and WebP bytes were written once by sharp 0.35.5 and are embedded, so the inputs never depend on
// the encoder being checked; the PNG is encoded here, losslessly, so only its pixels matter.

/** 96×64 JPEG, Display P3 ICC profile, EXIF orientation 6 (normalized to 64×96). */
const jpeg = Buffer.from(
  "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",
  "base64",
);

/** 80×60 lossy WebP with a varying alpha channel. */
const webp = Buffer.from(
  "UklGRiwCAABXRUJQVlA4WAoAAAAQAAAATwAAOwAAQUxQSHUAAAAVJ0AgQBkrppghIqL5AsZt20jybLag6b+7vRLZ731E9N9s2jYq3krHHnHImFI7y2rgFLI14s1wKUXQCBjClhgUREopDITNceOSYcqRavfKSSvVJZKqtb1umR6J62qV1VugD/96a3t92TXc662yaqXS+Xf5uwIAVlA4IJABAAAQDwCdASpQADwAPmkqjkW/or+/sykD8A0JbAZwZoEsBVAP4B+O+mAfwD8APyIpgH9m2s78A/AChjdi+Qfjd1uEuOKfjX+z3+36sHenu5+shvDX85oP9d8On/VKyBWNZyzKfBRdeTCEgJZEiWoRDEMnqEjksC3uYwb4/W6qT/r3/2gA/rRLJqDT4XpTXR5u0BUjFIBuMXYxyrsL9W7hBv//WMKQXROWHcrxFO243ZXcDRLoAolvTeuEX6+EFsX7JyEH9c1KXr8WAVNBAtC5ctx0M63AIsV3CL9fCK3OJD7CrPw+1j8/gWKttczVbtlmPdX7g3daOyOpj9iB/Rk7aLCyy47R/uqOU9zSYouzFAw1zyyl0NIvvKEiVhYzZZPCk+SlZZ8LHucaQBlLViZcmAdai+ykg2qld8WaAiOzQMmix7IkZeKBF+GDLmvuZqK4DgfcfWbCnK0HdlFUC10FqAUfyqOAvcBiYnMWBteaXUWh05oHxP2X9u0Q+kG/JfPdZ2oia11458kUMJkmdXVgAAAA",
  "base64",
);

function chunk(type: string, body: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** 1800×24 RGBA PNG: gradients, a checkerboard and a varying alpha, so resampling has detail to work on. */
function widePng() {
  const width = 1800;
  const height = 24;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const at = 1 + x * 4;
      row[at] = (x * 255) / (width - 1);
      row[at + 1] = (y * 255) / (height - 1);
      row[at + 2] = ((x >> 2) + (y >> 2)) % 2 ? 220 : 30;
      row[at + 3] = 32 + ((x * 7 + y * 11) % 200);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const SHARP_GOLDEN_INPUTS = {
  "jpeg-p3-orientation-6": jpeg,
  "webp-alpha": webp,
  "png-wide-alpha": widePng(),
} as const;

export type SharpGoldenName = keyof typeof SHARP_GOLDEN_INPUTS;
