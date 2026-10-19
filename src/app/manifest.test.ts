import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

import manifest from "./manifest";

const publicDir = new URL("../../public/", import.meta.url);

// The image processor shipped with Next.js, as scripts/generate-maskable-icon.mjs uses it. It is a dependency of
// Next.js, not of this project, so only the part used here is typed.
type RawImage = { data: Buffer; info: { width: number; height: number; channels: number } };
type Sharp = (input: Buffer) => { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<RawImage> } };
const require = createRequire(import.meta.url);
const sharp: Sharp = createRequire(require.resolve("next/package.json"))("sharp");

// Where the glyph lies on an icon: its visible pixels are those clearly unlike the background (#20231f). Distances
// are fractions of the side, measured from the canvas centre.
async function glyphGeometry(path: URL) {
  const { data, info } = await sharp(readFileSync(path)).raw().toBuffer({ resolveWithObject: true });
  const centre = (info.width - 1) / 2;
  let [minX, minY, maxX, maxY, radius, minAlpha] = [info.width, info.height, 0, 0, 0, 255];

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (info.channels === 4) minAlpha = Math.min(minAlpha, data[i + 3]);
      if (Math.abs(data[i] - 0x20) + Math.abs(data[i + 1] - 0x23) + Math.abs(data[i + 2] - 0x1f) > 60) {
        [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
        radius = Math.max(radius, Math.hypot(x - centre, y - centre));
      }
    }
  }

  const corner = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels).slice(0, 3)];

  return {
    size: `${info.width}x${info.height}`,
    minAlpha,
    corners: [
      corner(0, 0),
      corner(info.width - 1, 0),
      corner(0, info.height - 1),
      corner(info.width - 1, info.height - 1),
    ],
    radius: radius / info.width,
    aspect: (maxX - minX + 1) / (maxY - minY + 1),
    offsetX: ((minX + maxX) / 2 - centre) / info.width,
    offsetY: ((minY + maxY) / 2 - centre) / info.width,
  };
}

// Width and height from a PNG's IHDR chunk.
function pngSize(path: URL) {
  const png = readFileSync(path);
  assert.equal(png.toString("latin1", 1, 4), "PNG", `${path.pathname} is not a PNG`);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

test("the installed app opens the whole site, standalone, at its root", () => {
  const { id, start_url, scope, display, name, short_name } = manifest();

  assert.equal(id, "/");
  assert.equal(start_url, "/");
  assert.equal(scope, "/");
  assert.equal(display, "standalone");
  assert.equal(name, "Libra");
  assert.equal(short_name, "Libra");
});

test("the splash screen and title bar take the site's paper color", () => {
  const { background_color, theme_color } = manifest();

  assert.equal(background_color, "#fcfaf6");
  assert.equal(theme_color, "#fcfaf6");
});

test("every declared icon exists in public/ with its declared size and type", () => {
  const icons = manifest().icons ?? [];

  assert.ok(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));

  for (const icon of icons) {
    assert.equal(icon.type, "image/png", icon.src);
    assert.ok(icon.src.startsWith("/"), icon.src);
    assert.equal(pngSize(new URL(icon.src.slice(1), publicDir)), icon.sizes, icon.src);
  }
});

test("the any icons stay as they were and the maskable icon has its own file", () => {
  assert.deepEqual(manifest().icons, [
    { src: "/icons/libra-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/libra-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/libra-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
});

test("the maskable icon keeps the rest of the manifest as it was", () => {
  const { icons, ...rest } = manifest();

  assert.ok(icons);
  assert.deepEqual(rest, {
    id: "/",
    name: "Libra",
    short_name: "Libra",
    description: "Libros para leer gratis · Books to read for free",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fcfaf6",
    theme_color: "#fcfaf6",
  });
});

test("the maskable icon is opaque, on Libra's background, with the same glyph inside the safe zone", async () => {
  const maskable = await glyphGeometry(new URL("icons/libra-maskable-512.png", publicDir));
  const any = await glyphGeometry(new URL("icons/libra-512.png", publicDir));

  assert.equal(maskable.size, "512x512");
  assert.equal(maskable.minAlpha, 255);
  for (const corner of maskable.corners) assert.deepEqual(corner, [0x20, 0x23, 0x1f]);

  // A launcher may crop a maskable icon to any shape that contains the circle of 40% of its side.
  assert.ok(maskable.radius <= 0.34, `glyph reaches ${maskable.radius} of the side`);
  assert.ok(maskable.radius >= 0.28, `glyph shrunk to ${maskable.radius} of the side`);
  // The same glyph, only smaller: same proportions, centred as in the source.
  assert.ok(Math.abs(maskable.aspect / any.aspect - 1) < 0.02, `aspect ${maskable.aspect} vs ${any.aspect}`);
  assert.ok(Math.abs(maskable.offsetX) < 0.005, `horizontal offset ${maskable.offsetX}`);
  assert.ok(Math.abs(maskable.offsetY / (maskable.radius / any.radius) - any.offsetY) < 0.005, "vertical position");
});
