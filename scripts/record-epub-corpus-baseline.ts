import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintEpub, type EpubFingerprint } from "./lib/epub-corpus-baseline";

// Records scripts/lib/epub-corpus-baseline.json from the local EPUBs (default: imports/). Read-only on the EPUBs; no
// database, R2 or network. Re-record only when an extraction change has been reviewed, and review the JSON diff.
//
//   pnpm exec tsx scripts/record-epub-corpus-baseline.ts [directory]

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.resolve(process.argv[2] ?? path.join(root, "imports"));
const output = path.join(root, "scripts", "lib", "epub-corpus-baseline.json");

async function main() {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".epub"))
    .sort();

  if (files.length === 0) throw new Error(`No EPUB files in ${directory}`);

  const books: Record<string, EpubFingerprint> = {};
  for (const file of files) {
    books[file] = await fingerprintEpub(fs.readFileSync(path.join(directory, file)));
    console.log(`${file}: ${books[file].chapters.length} chapters, ${books[file].markup.images} images in the markup`);
  }

  fs.writeFileSync(output, `${JSON.stringify({ books }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, output)} (${files.length} EPUBs)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
