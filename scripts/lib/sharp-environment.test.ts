import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import type { ImageCodec } from "./epub-images";
import {
  collectSharpRuntimeEvidence,
  createSharpCodec,
  createVerifiedSharpCodec,
  nativeBindingProblems,
  SHARP_BYTE_LIBRARIES,
  SharpEnvironmentError,
  sharpCodecId,
  SUPPORTED_SHARP_ENVIRONMENTS,
  verifySharpEnvironment,
  type SharpRuntimeEvidence,
  type SupportedSharpEnvironment,
} from "./sharp-codec";

// The environment check that gates image processing for imports: codec id on the allowlist, sharp's prebuilt native
// binary loaded, golden hashes reproduced. Runtime evidence is built by hand to describe the approved Windows build,
// the WebAssembly build, a binary compiled from source and others, so every branch runs on any machine. Only the
// test of the real runtime depends on where it runs, and it asserts the right outcome either way.

const approved = SUPPORTED_SHARP_ENVIRONMENTS[0];

/** The approved win32-x64 build, as process.report and sharp.versions describe it. */
function approvedEvidence(overrides: Partial<SharpRuntimeEvidence> = {}): SharpRuntimeEvidence {
  const lib = String.raw`\\?\C:\libra\node_modules\.pnpm\@img+sharp-win32-x64@0.35.5\node_modules\@img\sharp-win32-x64\lib`;
  return {
    versions: {
      sharp: "0.35.5",
      vips: "8.18.7",
      mozjpeg: "0826579",
      png: "1.6.58",
      "zlib-ng": "2.3.3",
      webp: "1.6.0",
      lcms: "2.19.1",
      exif: "0.6.26",
      highway: "1.4.0",
      heif: "1.23.5",
    },
    platform: "win32-x64",
    simd: true,
    sharedObjects: [
      String.raw`C:\Program Files\nodejs\node.exe`,
      `${lib}\\sharp-win32-x64-0.35.5.node`,
      `${lib}\\libvips-cpp-8.18.7.dll`,
      `${lib}\\libvips-42.dll`,
    ],
    ...overrides,
  };
}

/** A codec that claims an id and hands the work to the real sharp codec. */
const claiming = (id: string, normalize: ImageCodec["normalize"] = createSharpCodec().normalize): ImageCodec => ({
  id,
  normalize,
});

async function refused(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SharpEnvironmentError, String(error));
    assert.match(error.message, pattern);
    assert.match(error.message, /no image was processed or uploaded/);
    return true;
  });
}

test("the allowlist approves exactly one environment: sharp 0.35.5 on win32-x64 with SIMD", () => {
  assert.equal(SUPPORTED_SHARP_ENVIRONMENTS.length, 1);
  assert.equal(
    approved.codecId,
    "sharp@0.35.5/libvips@8.18.7/mozjpeg@0826579/png@1.6.58/zlib-ng@2.3.3/webp@1.6.0/lcms@2.19.1/exif@0.6.26/highway@1.4.0/win32-x64/simd/settings-v2.013fec5dc66c",
  );
  assert.equal(sharpCodecId(approvedEvidence()), approved.codecId);
  for (const item of SUPPORTED_SHARP_ENVIRONMENTS) {
    assert.doesNotMatch(item.codecId, /linux|wasm|nosimd/);
    for (const hash of Object.values(item.golden)) assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test("the native binding check accepts sharp's prebuilt binary and its libvips, nothing else", () => {
  assert.deepEqual(nativeBindingProblems(approvedEvidence()), []);

  // The WebAssembly build loads no shared library of its own.
  const wasm = approvedEvidence({ sharedObjects: [String.raw`C:\Program Files\nodejs\node.exe`] });
  assert.match(nativeBindingProblems(wasm).join("\n"), /none \(WebAssembly or no native binding\)/);

  // A binary compiled from source, linked against some libvips.
  const fromSource = approvedEvidence({
    sharedObjects: [
      String.raw`C:\libra\node_modules\sharp\src\build\Release\sharp-win32-x64-0.35.5.node`,
      String.raw`C:\vips\bin\libvips-cpp-8.18.7.dll`,
    ],
  });
  const problems = nativeBindingProblems(fromSource).join("\n");
  assert.match(problems, /expected sharp's prebuilt binary/);
  assert.match(problems, /built from source or for WebAssembly/);
  assert.match(problems, /libvips-cpp 8\.18\.7 from sharp's prebuilt package is not loaded/);

  // A report without shared libraries cannot confirm anything, so it fails closed.
  assert.match(nativeBindingProblems(approvedEvidence({ sharedObjects: null })).join(), /unconfirmed/);

  // The binary of another version, or two sharp binaries at once.
  const other = approvedEvidence();
  const otherVersion = { ...other, versions: { ...other.versions, sharp: "0.35.6" } };
  assert.ok(nativeBindingProblems(otherVersion).length);
  const twice = approvedEvidence({
    sharedObjects: [...(other.sharedObjects ?? []), "/opt/other/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node"],
  });
  assert.ok(nativeBindingProblems(twice).length);
});

test("an environment that is not approved is refused before any image is normalized", async () => {
  let normalized = 0;
  const counting = (id: string) =>
    claiming(id, async (...args) => {
      normalized++;
      return createSharpCodec().normalize(...args);
    });

  // SIMD disabled, Linux, another sharp version: valid ids, none approved.
  for (const evidence of [
    approvedEvidence({ simd: false }),
    approvedEvidence({ platform: "linux-x64" }),
    approvedEvidence({ versions: { ...approvedEvidence().versions, sharp: "0.35.6" } }),
  ]) {
    await refused(verifySharpEnvironment(counting(sharpCodecId(evidence)), evidence), /not an approved environment/);
  }
  // Incomplete versions (a globally installed libvips reports only its own).
  await refused(
    verifySharpEnvironment(
      counting(approved.codecId),
      approvedEvidence({ versions: { sharp: "0.35.5", vips: "8.18.7" } }),
    ),
    /Codec id: \(incomplete\)[\s\S]*mozjpeg is not reported/,
  );
  // A codec that claims the approved id but is not the one this runtime builds.
  await refused(
    verifySharpEnvironment(counting(approved.codecId), approvedEvidence({ simd: false })),
    /does not match this runtime/,
  );
  // The approved id with the WebAssembly build or a binary compiled from source.
  await refused(
    verifySharpEnvironment(
      counting(approved.codecId),
      approvedEvidence({ sharedObjects: [String.raw`C:\Program Files\nodejs\node.exe`] }),
    ),
    /WebAssembly or no native binding/,
  );
  await refused(
    verifySharpEnvironment(
      counting(approved.codecId),
      approvedEvidence({
        sharedObjects: [String.raw`C:\libra\node_modules\sharp\src\build\Release\sharp-win32-x64-0.35.5.node`],
      }),
    ),
    /built from source/,
  );
  assert.equal(normalized, 0, "no golden input, let alone an EPUB image, was normalized");
});

test("golden hashes that differ refuse the environment even when the id and binding match", async () => {
  const wrong: SupportedSharpEnvironment = {
    codecId: approved.codecId,
    golden: { ...approved.golden, "png-wide-alpha": "0".repeat(64) },
  };
  await refused(
    verifySharpEnvironment(claiming(approved.codecId), approvedEvidence(), [wrong]),
    /golden png-wide-alpha: [0-9a-f]{64}, expected 0{64}/,
  );

  // A codec whose bytes are not the approved build's: the output is valid but different.
  const real = createSharpCodec();
  const different = claiming(approved.codecId, async (data, inspection, target) => {
    const output = await real.normalize(data, inspection, target);
    return target.format === "jpeg" ? sharp(output).jpeg({ quality: 50 }).toBuffer() : output;
  });
  await refused(verifySharpEnvironment(different, approvedEvidence()), /golden jpeg-p3-orientation-6/);
});

const runtime = collectSharpRuntimeEvidence();
const runtimeId = (() => {
  try {
    return sharpCodecId(runtime);
  } catch {
    return null;
  }
})();
const onApproved = SUPPORTED_SHARP_ENVIRONMENTS.some((item) => item.codecId === runtimeId);

test("the real runtime is verified where it is approved and refused anywhere else", async () => {
  if (onApproved) {
    const codec = await createVerifiedSharpCodec();
    assert.equal(codec.id, runtimeId);
    assert.equal(codec.environment.codecId, runtimeId);
    assert.deepEqual(nativeBindingProblems(runtime), []);
  } else {
    await refused(createVerifiedSharpCodec(), /not an approved environment|incomplete|native|golden/);
  }
});

test(
  "the approved runtime reports the evidence the allowlist was recorded from",
  { skip: !onApproved && "not the approved environment" },
  () => {
    for (const name of ["sharp", ...SHARP_BYTE_LIBRARIES]) assert.ok(runtime.versions[name], name);
    assert.equal(runtime.platform, "win32-x64");
    assert.equal(runtime.simd, true);
    assert.ok(runtime.sharedObjects?.some((item) => /sharp-win32-x64-0\.35\.5\.node$/.test(item)));
  },
);
