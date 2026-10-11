import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Reuse the image processor already shipped with Next.js; no new dependency.
const requireNext = createRequire(import.meta.resolve("next/package.json"));
const sharp = requireNext("sharp");
const source = await readFile("src/app/icon.svg");
const png = (size) =>
  sharp(source).resize(size, size).flatten({ background: "#20231f" }).ensureAlpha().png().toBuffer();

await mkdir("public/icons", { recursive: true });
await writeFile("src/app/apple-icon.png", await png(180));
await writeFile("public/icons/libra-192.png", await png(192));
await writeFile("public/icons/libra-512.png", await png(512));

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, data] of images.entries()) {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
}
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...images]));
