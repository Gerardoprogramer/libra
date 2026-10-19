import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Writes public/icons/libra-maskable-512.png and nothing else; scripts/generate-icons.mjs keeps the other icons.
// Reuse the image processor already shipped with Next.js; no new dependency.
const requireNext = createRequire(import.meta.resolve("next/package.json"));
const sharp = requireNext("sharp");

const SIZE = 512;
const BACKGROUND = "#20231f";
// A maskable icon can be cropped to any shape that contains the circle of 40% of its side around the centre. The
// glyph is kept within 32%, a margin below that limit.
const SAFE_RADIUS = 0.4;
const TARGET_RADIUS = 0.32;

const source = await readFile(new URL("../src/app/icon.svg", import.meta.url));
const output = new URL("../public/icons/libra-maskable-512.png", import.meta.url);

// The glyph's farthest visible pixel from the centre, as a fraction of the side. Visible: clearly unlike the
// background, so the glyph's anti-aliased edge counts and the background's rounded corners do not.
async function glyphRadius(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(BACKGROUND.slice(start, start + 2), 16));
  const centre = (info.width - 1) / 2;
  let radius = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) > 60) {
        radius = Math.max(radius, Math.hypot(x - centre, y - centre));
      }
    }
  }

  return radius / info.width;
}

const full = await sharp(source).resize(SIZE, SIZE).flatten({ background: BACKGROUND }).png().toBuffer();
// The glyph is rounded to an even size: an odd one could not be centred on the even canvas without a half-pixel shift.
const glyphSize = 2 * Math.round((SIZE * (TARGET_RADIUS / (await glyphRadius(full)))) / 2);
const glyph = await sharp(source).resize(glyphSize, glyphSize).png().toBuffer();
const composed = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: BACKGROUND } })
  .composite([{ input: glyph, gravity: "centre" }])
  .png()
  .toBuffer();
// sharp composites last, after any other operation in the same pipeline: the alpha channel is dropped in a second one.
const icon = await sharp(composed).removeAlpha().png().toBuffer();

const radius = await glyphRadius(icon);
if (radius > SAFE_RADIUS) throw new Error(`The glyph reaches ${radius} of the side, outside the maskable safe zone.`);

await writeFile(output, icon);
console.log(`Wrote ${fileURLToPath(output)}: ${SIZE}x${SIZE}, glyph within ${(radius * 100).toFixed(1)}% of the side.`);
