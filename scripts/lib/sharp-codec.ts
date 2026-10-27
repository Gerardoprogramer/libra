import { createHash } from "node:crypto";

import sharp, { type Sharp } from "sharp";

import {
  detectImageFormat,
  IMAGE_LIMITS,
  processImage,
  type ImageCodec,
  type ImageFormat,
  type ImageLimits,
} from "./epub-images";
import { SHARP_GOLDEN_INPUTS, type SharpGoldenName } from "./sharp-golden";

// The ImageCodec that proves an image decodes and re-encodes it, with sharp (libvips). It only ever receives images
// inspectImage accepted (processImage guarantees it), and checks again what it is given rather than trusting the
// header: the bytes must still be the inspected format (so SVG, which libvips can rasterize, never reaches it), the
// decoder's own reading of the file must agree on format, frame count and size, and the pixel limit is enforced by
// the decoder itself. Every pixel is decoded (failOn "warning": a truncated or damaged stream is an error, not a
// partial image), then oriented, scaled, converted to sRGB and re-encoded with fixed settings and no metadata.

/** Encoder settings, part of the codec id: changing them changes the bytes, and so the keys. */
export const SHARP_ENCODING = {
  jpeg: { quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" },
  png: { compressionLevel: 9, adaptiveFiltering: true },
  webp: { quality: 82, alphaQuality: 100, effort: 4 },
} as const;

/** Pipeline settings that shape the pixels, part of the codec id like the encoder settings. */
export const SHARP_PIPELINE = {
  failOn: "warning",
  resize: { fit: "fill", kernel: "lanczos3", withoutEnlargement: true },
  colourspace: "srgb",
} as const;

/**
 * Bumped when normalize changes in a way the settings above do not show (a step added, removed or reordered). The
 * id also carries a digest of the settings, so changing one of them changes the id even without a bump.
 */
export const SHARP_SETTINGS_VERSION = 2;

/**
 * The libraries whose version can change the normalized bytes, in the order the id names them: libvips (decoding,
 * orientation, resampling, colour conversion), the JPEG, PNG and WebP codecs, zlib-ng (PNG compression), lcms (ICC
 * to sRGB), libexif (orientation) and highway (the SIMD resampling paths). sharp's prebuilt binaries report each of
 * them; a libvips installed globally reports only its own version, so its codecs are unknown and the id refuses it.
 */
export const SHARP_BYTE_LIBRARIES = ["vips", "mozjpeg", "png", "zlib-ng", "webp", "lcms", "exif", "highway"] as const;

export interface SharpCodecIdInput {
  versions: Partial<Record<string, string>>;
  /** sharp's platform name for the binaries in use, e.g. "win32-x64", "linux-x64", "linuxmusl-arm64". */
  platform: string;
  /** Whether libvips uses SIMD instructions (sharp.simd()): the vector and scalar paths may round differently. */
  simd: boolean;
  settingsVersion?: number;
  settings?: unknown;
}

/** One part of the id: no "/" or "@", which separate the parts, and nothing a version string never contains. */
const ID_PART = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
const MAX_CODEC_ID_LENGTH = 200; // image_assets_codec_id_check

/**
 * The codec id: every effective version and setting that can change the normalized bytes, so that two runs with the
 * same id give the same bytes for the same source. Throws, instead of returning a partial id, when a library is
 * not reported or a value is malformed. For example:
 * "sharp@0.35.5/libvips@8.18.7/mozjpeg@0826579/png@1.6.58/zlib-ng@2.3.3/webp@1.6.0/lcms@2.19.1/exif@0.6.26/
 * highway@1.4.0/win32-x64/simd/settings-v2.<12 hex>" (one line).
 */
export function sharpCodecId({
  versions,
  platform,
  simd,
  settingsVersion = SHARP_SETTINGS_VERSION,
  settings = { pipeline: SHARP_PIPELINE, encoding: SHARP_ENCODING },
}: SharpCodecIdInput): string {
  const part = (name: string, value: string | undefined) => {
    if (value === undefined || !ID_PART.test(value)) {
      throw new Error(
        `sharp codec id: ${name} is ${value === undefined ? "not reported" : `malformed (${JSON.stringify(value)})`}; ` +
          "the normalized bytes would not be reproducible (a globally installed libvips is not supported)",
      );
    }
    return value;
  };
  const digest = createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 12);
  const id = [
    `sharp@${part("sharp", versions.sharp)}`,
    ...SHARP_BYTE_LIBRARIES.map((name) => `${name === "vips" ? "libvips" : name}@${part(name, versions[name])}`),
    part("platform", platform),
    simd ? "simd" : "nosimd",
    `settings-v${part("settings version", String(settingsVersion))}.${digest}`,
  ].join("/");
  if (id.length > MAX_CODEC_ID_LENGTH) throw new Error(`sharp codec id: longer than ${MAX_CODEC_ID_LENGTH} characters`);
  return id;
}

/** sharp's name for the platform its binaries are built for (glibc and musl Linux builds differ). */
function runtimePlatform() {
  if (process.platform !== "linux") return `${process.platform}-${process.arch}`;
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return `${report.header?.glibcVersionRuntime ? "linux" : "linuxmusl"}-${process.arch}`;
}

/** The decoded size libvips reports, as stored (before orientation). */
async function readHeader(data: Buffer, limits: ImageLimits) {
  const metadata = await sharp(data, { failOn: SHARP_PIPELINE.failOn, limitInputPixels: limits.maxPixels }).metadata();
  return { format: metadata.format, width: metadata.width, height: metadata.height, pages: metadata.pages ?? 1 };
}

export function createSharpCodec(limits: ImageLimits = IMAGE_LIMITS): ImageCodec {
  // One image at a time per call and no operation cache: an import holds as little decoded image data as it can.
  sharp.cache(false);
  for (const format of ["jpeg", "png", "webp"] as const) {
    if (!sharp.format[format].input.buffer || !sharp.format[format].output.buffer) {
      throw new Error(`sharp codec: this libvips cannot decode and encode ${format}`);
    }
  }
  const id = sharpCodecId({ versions: sharp.versions, platform: runtimePlatform(), simd: sharp.simd() });

  return {
    id,

    async normalize(data, inspection, target) {
      if (detectImageFormat(data) !== inspection.format) {
        throw new Error(`the bytes are not the inspected ${inspection.format}`);
      }
      const header = await readHeader(data, limits);
      if (header.format !== inspection.format) {
        throw new Error(`the decoder reads ${String(header.format)}, inspected as ${inspection.format}`);
      }
      if (header.pages !== 1) throw new Error(`the decoder reads ${header.pages} frames`);
      if (header.width !== inspection.width || header.height !== inspection.height) {
        throw new Error(
          `the decoder reads ${header.width}×${header.height}, inspected as ${inspection.width}×${inspection.height}`,
        );
      }

      const pipeline = sharp(data, {
        failOn: SHARP_PIPELINE.failOn,
        limitInputPixels: limits.maxPixels,
        sequentialRead: true,
        animated: false,
      })
        .autoOrient()
        // Exact target: the proportional size computed by normalizedSize, never larger than the oriented source.
        .resize(target.width, target.height, SHARP_PIPELINE.resize)
        .toColourspace(SHARP_PIPELINE.colourspace);

      const encoders: Record<ImageFormat, () => Sharp> = {
        jpeg: () => pipeline.jpeg(SHARP_ENCODING.jpeg),
        png: () => pipeline.png(SHARP_ENCODING.png),
        webp: () => pipeline.webp(SHARP_ENCODING.webp),
      };
      // No withMetadata/keepMetadata: EXIF, ICC, XMP and IPTC are not written.
      const { data: output, info } = await encoders[target.format]().toBuffer({ resolveWithObject: true });
      if (info.format !== target.format || info.width !== target.width || info.height !== target.height) {
        throw new Error(
          `the encoder wrote ${info.format} ${info.width}×${info.height}, expected ${target.format} ${target.width}×${target.height}`,
        );
      }
      return output;
    },
  };
}

/*
 * Supported environments. An import normalizes images only with a codec verified here, before any image of the EPUB
 * is processed and before anything is uploaded. Three independent checks, all required:
 *
 * 1. The codec id, computed from this runtime, is one of SUPPORTED_SHARP_ENVIRONMENTS exactly (versions, platform,
 *    SIMD, settings). A globally installed libvips never gets that far: its id is incomplete and sharpCodecId throws.
 * 2. The process has loaded sharp's prebuilt native binary for this platform and version, and the libvips library
 *    beside it (process.report sharedObjects). This tells a native binding from the WebAssembly build, which loads no
 *    shared library, and from a binary compiled from source (sharp/src/build), which loads from another path. It is
 *    one indication, not proof: it shows paths, not contents, the report can be unavailable (then the check fails),
 *    and a file replaced at the same path would pass it. Hence the third check.
 * 3. The golden inputs (sharp-golden.ts) normalize to exactly the SHA-256 recorded for this environment, so the bytes
 *    this build writes are the bytes the approved build wrote.
 *
 * Adding an environment means recording its codec id from that environment, checking its native binding there, and
 * recording its golden hashes there; never copying them from another one.
 */

export interface SupportedSharpEnvironment {
  codecId: string;
  /** SHA-256 of each golden input after processImage in this environment. */
  golden: Readonly<Record<SharpGoldenName, string>>;
}

export const SUPPORTED_SHARP_ENVIRONMENTS: readonly SupportedSharpEnvironment[] = [
  {
    codecId:
      "sharp@0.35.5/libvips@8.18.7/mozjpeg@0826579/png@1.6.58/zlib-ng@2.3.3/webp@1.6.0/lcms@2.19.1/exif@0.6.26/highway@1.4.0/win32-x64/simd/settings-v2.013fec5dc66c",
    golden: {
      "jpeg-p3-orientation-6": "00262bc030401fe76ea56c3b335ad88c04960a78854c2ef759e68f34fbea8b4c",
      "webp-alpha": "28231e1fd33a5f605c09c8d2603e67be66558f9926803b2b16c000bce82b18d6",
      "png-wide-alpha": "99e59f390ab674ae51c9aa20ef8088bfc1dd832d1706b08fa5d797b4352014a9",
    },
  },
];

/** What the running process says about its sharp build. */
export interface SharpRuntimeEvidence {
  versions: Partial<Record<string, string>>;
  platform: string;
  simd: boolean;
  /** Paths of the shared libraries the process has loaded, or null when the report lists none. */
  sharedObjects: readonly string[] | null;
}

export function collectSharpRuntimeEvidence(): SharpRuntimeEvidence {
  const report = process.report.getReport() as { sharedObjects?: unknown };
  const sharedObjects = Array.isArray(report.sharedObjects)
    ? report.sharedObjects.filter((item): item is string => typeof item === "string")
    : null;
  return {
    versions: { ...sharp.versions },
    platform: runtimePlatform(),
    simd: sharp.simd(),
    sharedObjects: sharedObjects?.length ? sharedObjects : null,
  };
}

/** Why the loaded binding is not sharp's prebuilt native binary for this platform; empty when it is. */
export function nativeBindingProblems({ versions, platform, sharedObjects }: SharpRuntimeEvidence): string[] {
  if (!sharedObjects)
    return ["the process report lists no shared libraries, so the native sharp binary is unconfirmed"];
  const paths = sharedObjects.map((item) => item.replace(/^\\\\\?\\/, "").replace(/\\/g, "/"));
  const problems: string[] = [];

  const binaries = paths.filter((item) => /\/sharp-[^/]*\.node$/.test(item));
  const expected = `/@img/sharp-${platform}/lib/sharp-${platform}-${versions.sharp}.node`;
  if (binaries.length !== 1 || !binaries[0].endsWith(expected)) {
    problems.push(
      `expected sharp's prebuilt binary ...${expected}, the process loaded ${binaries.length ? binaries.join(", ") : "none (WebAssembly or no native binding)"}`,
    );
  }
  if (paths.some((item) => /\/sharp\/src\/build\//.test(item) || /wasm32/.test(item))) {
    problems.push("a sharp binary built from source or for WebAssembly is loaded");
  }
  const libvips = paths.filter(
    (item) =>
      (item.includes(`/@img/sharp-${platform}/lib/`) || item.includes(`/@img/sharp-libvips-${platform}/lib/`)) &&
      /\/libvips-cpp[^/]*$/.test(item) &&
      item.includes(String(versions.vips)),
  );
  if (!libvips.length) problems.push(`libvips-cpp ${versions.vips} from sharp's prebuilt package is not loaded`);
  return problems;
}

export class SharpEnvironmentError extends Error {
  constructor(
    readonly codecId: string | null,
    readonly problems: string[],
  ) {
    super(
      `The image codec environment is not supported for imports; no image was processed or uploaded.\n` +
        `Codec id: ${codecId ?? "(incomplete)"}\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "SharpEnvironmentError";
  }
}

/** A codec that passed verifySharpEnvironment, with the environment it matched. */
export type VerifiedImageCodec = ImageCodec & { readonly environment: SupportedSharpEnvironment };

/**
 * Verifies the codec against this runtime and the allowlist, in order: id, native binding, golden hashes. Throws a
 * SharpEnvironmentError at the first failing check; the golden inputs are only normalized once the first two pass.
 */
export async function verifySharpEnvironment(
  codec: ImageCodec,
  evidence: SharpRuntimeEvidence,
  allowlist: readonly SupportedSharpEnvironment[] = SUPPORTED_SHARP_ENVIRONMENTS,
): Promise<VerifiedImageCodec> {
  let runtimeId: string;
  try {
    runtimeId = sharpCodecId(evidence);
  } catch (error) {
    throw new SharpEnvironmentError(null, [error instanceof Error ? error.message : String(error)]);
  }
  if (codec.id !== runtimeId) {
    throw new SharpEnvironmentError(codec.id, [`the codec id does not match this runtime (${runtimeId})`]);
  }
  const environment = allowlist.find((item) => item.codecId === codec.id);
  if (!environment) throw new SharpEnvironmentError(codec.id, ["this codec id is not an approved environment"]);

  const binding = nativeBindingProblems(evidence);
  if (binding.length) throw new SharpEnvironmentError(codec.id, binding);

  const golden: string[] = [];
  for (const [name, input] of Object.entries(SHARP_GOLDEN_INPUTS) as [SharpGoldenName, Buffer][]) {
    const result = await processImage(`golden/${name}`, input, codec);
    const actual = result.status === "ready" ? result.sha256 : `rejected (${result.issue.message})`;
    if (actual !== environment.golden[name])
      golden.push(`golden ${name}: ${actual}, expected ${environment.golden[name]}`);
  }
  if (golden.length) throw new SharpEnvironmentError(codec.id, golden);

  return { id: codec.id, normalize: (...args) => codec.normalize(...args), environment };
}

/** The sharp codec, verified for imports. */
export function createVerifiedSharpCodec(limits: ImageLimits = IMAGE_LIMITS): Promise<VerifiedImageCodec> {
  return verifySharpEnvironment(createSharpCodec(limits), collectSharpRuntimeEvidence());
}
