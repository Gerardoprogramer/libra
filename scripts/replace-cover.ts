// Replaces the cover of one Project Gutenberg edition with an image file, such as a cover made for Libra in
// scripts/covers/. A dry run by default: it validates the arguments and the image, reads the edition inside a READ ONLY
// transaction and prints the current cover, the object key and URL that --apply would use, and the exact options the
// write needs; nothing is uploaded or written.
//
// --apply writes only to a target confirmed with --confirm-database, and only with --expect-current <url|none>: the
// current cover the dry run printed. It checks that anchor, uploads the image to R2 under a new content-addressed key
// below covers/libra/ (the prefix a re-import keeps; the previous object is never touched), then locks the edition,
// re-plans under the lock and updates editions.cover_url only if it still holds the expected URL; finally it
// invalidates the book's cached pages. Only cover_url and updated_at change: chapters, rights and publication status
// are never written. The steps live in applyCoverReplacement (lib/cover-replacement.ts), the SQL in
// lib/cover-replacement-store.ts.
//
// R2_PUBLIC_URL is checked against the edition's current cover. An edition without a cover offers nothing to check it
// against, so the operator confirms the base with --expect-base <R2_PUBLIC_URL>.
//
// Recovery: if the upload succeeds and a check refuses the write, the transaction rolls back and the uploaded object
// stays in R2, unreferenced. If the write fails in a way that may have followed the commit, the object may or may not
// be referenced: running the same command again either reports that the edition already shows the image (and
// invalidates the cache) or retries the write, re-uploading the same bytes to the same key.
import { readFile } from "node:fs/promises";

import { config } from "dotenv";
import postgres from "postgres";
import sharp from "sharp";

import { parseMediaBase } from "./lib/cover-origin-migration";
import {
  applyCoverReplacement,
  checkCoverImage,
  expectCurrentArgument,
  parseReplaceCoverArguments,
  planCoverReplacement,
} from "./lib/cover-replacement";
import { createCoverReplacementStore } from "./lib/cover-replacement-store";
import { describeDatabaseTarget } from "./lib/import-plan";
import { uploadCover } from "./lib/r2";
import { revalidateEditorialCache } from "./lib/revalidate-cache";
import { assertWriteAllowed, sslFor } from "./lib/write-guard";

const usage = `Usage: pnpm db:replace-cover --gutenberg-id <id> --book <slug> --file <image> [--expect-base <url>]
                              [--apply --expect-current <url|none> --confirm-database <id>]

  --gutenberg-id <id>        Project Gutenberg id of the edition, e.g. 768
  --book <slug>              Slug of the book the edition must belong to, e.g. wuthering-heights
  --file <path>              JPEG, PNG or WebP, 2:3 portrait, at least 600px wide, at most 8 MiB
  --expect-base <url>        The public base covers are served from; must equal R2_PUBLIC_URL. Required when the
                             edition has no cover to check R2_PUBLIC_URL against.
  --apply                    Upload the image and write the new URL. Without it, nothing is uploaded or written.
  --expect-current <url|none>
                             Required with --apply: the current cover printed by the dry run, or none. The write is
                             refused if the cover changed since.
  --confirm-database <id>    Target id printed by the dry run; required with --apply on a remote database.`;

config({ path: ".env.local", quiet: true });

let parsed: ReturnType<typeof parseReplaceCoverArguments>;
try {
  parsed = parseReplaceCoverArguments(process.argv.slice(2));
} catch (error) {
  console.error(`${error instanceof Error ? error.message : error}\n\n${usage}`);
  process.exit(1);
}

if (parsed.help) {
  console.log(usage);
  process.exit(0);
}

const { gutenbergId, bookSlug: expectedBook, file, expectBase: expectedBase } = parsed;
const publicBase = parseMediaBase(process.env.R2_PUBLIC_URL, "R2_PUBLIC_URL");
if (!process.env.DIRECT_DATABASE_URL) throw new Error("DIRECT_DATABASE_URL is not defined");
const connectionString: string = process.env.DIRECT_DATABASE_URL;

const target = describeDatabaseTarget(connectionString);
console.log(`Target database: ${target.host} (role ${target.role}, id ${target.token})`);
console.log(`Mode: ${parsed.apply ? "APPLY" : "DRY RUN (nothing is uploaded or written)"}`);

const sql = postgres(connectionString, { max: 1, prepare: false, ssl: sslFor(connectionString) });
const store = createCoverReplacementStore(sql, gutenbergId);

async function main() {
  const data = await readFile(file);
  const image = checkCoverImage(data, await sharp(data).metadata());
  console.log(`Image: ${file} (${image.mediaType}, ${image.width}x${image.height}, ${data.length} bytes)`);

  const edition = await store.read();
  console.log(`Edition: ${edition.id} (book ${edition.bookSlug}, Gutenberg ${edition.sourceIdentifier})`);
  console.log(`Current cover: ${expectCurrentArgument(edition.coverUrl)}`);
  const plan = planCoverReplacement({ edition, expectedBook, data, image, publicBase, expectedBase });
  console.log(`New cover:     ${plan.url}`);
  console.log(`R2 object key: ${plan.key}`);

  if (!parsed.apply) {
    if (plan.unchanged) {
      console.log("\nThe edition already shows this image; nothing to upload or write.");
      return;
    }
    if (parsed.expectCurrent !== undefined && parsed.expectCurrent !== plan.previousUrl) {
      console.log(
        `\nWARNING: --expect-current ${expectCurrentArgument(parsed.expectCurrent)} is not the current cover.`,
      );
    }
    const write = [
      "--apply",
      `--expect-current ${expectCurrentArgument(plan.previousUrl)}`,
      ...(expectedBase ? [`--expect-base ${expectedBase.href}`] : []),
      ...(target.isLocal ? [] : [`--confirm-database ${target.token}`]),
    ];
    console.log(`\nDry run only. To write this plan, repeat the command with: ${write.join(" ")}`);
    return;
  }

  // parseReplaceCoverArguments already refuses --apply without --expect-current; this keeps `none` (null) apart.
  const expectedCurrent = parsed.expectCurrent;
  if (expectedCurrent === undefined) throw new Error("--apply requires --expect-current <url|none>.");

  assertWriteAllowed({
    connectionString,
    // Rebuilt from the parsed value, so --confirm-database=<id> is read like --confirm-database <id>.
    args: parsed.confirmDatabase !== undefined ? ["--confirm-database", parsed.confirmDatabase] : [],
    script: "db:replace-cover",
    allowRemote: true,
  });

  await applyCoverReplacement(
    {
      plan,
      edition,
      expectedBook,
      expectedCurrent,
      data,
      image,
      publicBase,
      expectedBase,
    },
    { upload: uploadCover, withLockedEdition: store.withLockedEdition, revalidate: revalidateEditorialCache },
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
