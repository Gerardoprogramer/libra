// Replaces the cover of one Project Gutenberg edition with an image made for Libra (scripts/covers/). The object key is
// covers/libra/<book slug>-<Gutenberg id>-<hash>.<ext> (coverKeyFor in r2.ts with `custom`): content-addressed like the
// importer's keys, so the new cover gets a new URL and the previous object is left untouched in R2, and under the
// covers/libra/ prefix that tells a re-import to keep it (custom-cover.ts). Planning is pure; the --apply half takes
// its side effects as dependencies (applyCoverReplacement).
import { parseArgs } from "node:util";

import { parseMediaBase, type MediaBase } from "./cover-origin-migration";
import { isValidBookSlug } from "./import-plan";
import { detectCoverImage } from "./parse-epub";
import { coverKeyFor } from "./r2";

/** Smallest accepted width: the book page asks for up to 560px (280px at 2x). */
export const minimumCoverWidth = 600;
/** The largest cover src/lib/social-image.tsx embeds in a social card; a bigger one would fall back to no cover. */
export const maximumCoverBytes = 8 * 1024 * 1024;

export interface ReplaceCoverArguments {
  help: boolean;
  gutenbergId: string;
  bookSlug: string;
  file: string;
  apply: boolean;
  confirmDatabase?: string;
  /**
   * --expect-current: the cover URL the dry run showed, or null for `none` (the edition had no cover). Undefined when
   * not given, which only a dry run allows.
   */
  expectCurrent?: string | null;
  /** --expect-base: the public base the operator confirms; required when the edition has no cover to check against. */
  expectBase?: MediaBase;
}

/**
 * Parses `pnpm db:replace-cover` arguments. Every value option must appear once: a repeated --book or --gutenberg-id
 * is refused instead of silently keeping the last one. The slug must be a valid book slug, so a file path passed as
 * --book stops here, before any database access. --apply requires --expect-current, so a write is always anchored to
 * the cover the operator reviewed.
 */
export function parseReplaceCoverArguments(rawArgs: readonly string[]): ReplaceCoverArguments {
  // pnpm may forward the separator in `pnpm db:replace-cover -- --gutenberg-id 768`.
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : [...rawArgs];
  const { values } = parseArgs({
    args,
    options: {
      "gutenberg-id": { type: "string", multiple: true },
      book: { type: "string", multiple: true },
      file: { type: "string", multiple: true },
      apply: { type: "boolean", default: false },
      "confirm-database": { type: "string", multiple: true },
      "expect-current": { type: "string", multiple: true },
      "expect-base": { type: "string", multiple: true },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  type ValueOption = "gutenberg-id" | "book" | "file" | "confirm-database" | "expect-current" | "expect-base";
  const one = (name: ValueOption, required: boolean) => {
    const list = values[name] ?? [];
    if (list.length > 1) throw new Error(`--${name} was given ${list.length} times; give it once.`);
    const [value] = list;
    if (value !== undefined && (value.trim() === "" || value.startsWith("-"))) {
      throw new Error(`--${name} needs a value.`);
    }
    if (required && value === undefined) throw new Error(`--${name} is required.`);
    return value;
  };

  if (values.help) return { help: true, gutenbergId: "", bookSlug: "", file: "", apply: false };

  const gutenbergId = one("gutenberg-id", true)!;
  const bookSlug = one("book", true)!;
  const file = one("file", true)!;
  const confirmDatabase = one("confirm-database", false);
  const rawCurrent = one("expect-current", false);
  const rawBase = one("expect-base", false);

  if (!/^[1-9]\d{0,9}$/.test(gutenbergId))
    throw new Error(`--gutenberg-id must be a Project Gutenberg number, e.g. 768.`);
  if (!isValidBookSlug(bookSlug)) {
    throw new Error(`--book must be a book slug such as wuthering-heights, not "${bookSlug}".`);
  }
  if (confirmDatabase !== undefined && !values.apply) throw new Error("--confirm-database is only used with --apply.");
  if (values.apply && rawCurrent === undefined) {
    throw new Error("--apply requires --expect-current <url|none>, the current cover printed by the dry run.");
  }

  return {
    help: false,
    gutenbergId,
    bookSlug,
    file,
    apply: values.apply ?? false,
    ...(confirmDatabase !== undefined ? { confirmDatabase } : {}),
    ...(rawCurrent !== undefined ? { expectCurrent: parseExpectedCurrent(rawCurrent) } : {}),
    ...(rawBase !== undefined ? { expectBase: parseMediaBase(rawBase, "--expect-base") } : {}),
  };
}

/**
 * `none`, or a stored cover URL. The value is compared with the stored one byte for byte; it is only checked here for
 * the shape every stored cover has (HTTPS, no credentials), so a typo fails before any database access.
 */
function parseExpectedCurrent(value: string): string | null {
  if (value === "none") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--expect-current must be the cover URL printed by the dry run, or "none".');
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error('--expect-current must be an HTTPS cover URL without credentials, or "none".');
  }
  return value;
}

/** The value to pass as --expect-current for a stored cover. */
export function expectCurrentArgument(coverUrl: string | null): string {
  return coverUrl ?? "none";
}

/** The public base of a stored cover URL: everything before `/covers/`, or null when it has another shape. */
export function coverUrlBase(url: string): string | null {
  const index = url.lastIndexOf("/covers/");
  return index > 0 ? url.slice(0, index) : null;
}

export interface CoverImage {
  mediaType: string;
  extension: string;
  width: number;
  height: number;
}

/**
 * Recognizes the format by its bytes, as the importer does, and requires the 2:3 portrait the site's cover frames use
 * (aspect-2/3). `size` is what the image decoder read from the same bytes; an EXIF orientation of 5–8 means the
 * browser shows the image rotated a quarter turn, so its displayed width is the stored height.
 */
export function checkCoverImage(
  data: Buffer,
  size: { width?: number; height?: number; orientation?: number },
): CoverImage {
  const format = detectCoverImage(data);
  if (!format) throw new Error("The cover must be a JPEG, PNG or WebP image.");
  if (data.length > maximumCoverBytes) {
    throw new Error(`The cover is ${data.length} bytes; social cards embed at most ${maximumCoverBytes}.`);
  }

  const turned = size.orientation !== undefined && size.orientation >= 5 && size.orientation <= 8;
  const width = turned ? size.height : size.width;
  const height = turned ? size.width : size.height;
  if (!width || !height) throw new Error("The cover's dimensions could not be read.");
  if (width < minimumCoverWidth)
    throw new Error(`The cover is ${width}px wide; at least ${minimumCoverWidth}px needed.`);
  if (Math.abs(width / height - 2 / 3) > 0.01) {
    throw new Error(`The cover is ${width}x${height}; a 2:3 portrait is required.`);
  }

  return { ...format, width, height };
}

export interface ReplacementEdition {
  id: string;
  bookSlug: string;
  sourceIdentifier: string;
  coverUrl: string | null;
}

export interface CoverReplacementPlan {
  editionId: string;
  key: string;
  /** Public URL of the new cover under the configured base. */
  url: string;
  /** The stored URL the write must still find, or null when the edition has no cover. */
  previousUrl: string | null;
  /** The edition already shows this exact image: nothing to upload or write. */
  unchanged: boolean;
}

/**
 * A check of the replacement refused the write: thrown before anything was written, or inside the transaction, which
 * then rolls back. Any other error during the write may come after the commit reached the server.
 */
export class CoverReplacementRefusedError extends Error {}

/**
 * Checks that `publicBase` (R2_PUBLIC_URL) is where the deployment serves covers from, before a URL is built with it.
 * The evidence is the edition's own cover, stored by the deployment. Without one there is nothing reliable to compare
 * in this run, so the operator must confirm the base with --expect-base, and it must be the configured one.
 */
export function verifyPublicBase({
  publicBase,
  currentCoverUrl,
  expectedBase,
}: {
  publicBase: MediaBase;
  currentCoverUrl: string | null;
  expectedBase?: MediaBase;
}): void {
  if (expectedBase && expectedBase.href !== publicBase.href) {
    throw new CoverReplacementRefusedError(
      `--expect-base ${expectedBase.href} does not match R2_PUBLIC_URL ${publicBase.href}; nothing was changed.`,
    );
  }
  if (currentCoverUrl) {
    // If the stored cover lives under another base, this environment does not match the deployed one (for example,
    // during the move to a custom domain, docs/r2-custom-domain.md), and the new URL could fall outside
    // next.config.ts's allowed covers once the previous base is removed.
    const currentBase = coverUrlBase(currentCoverUrl);
    if (currentBase !== publicBase.href) {
      throw new CoverReplacementRefusedError(
        `The current cover is under ${currentBase ?? currentCoverUrl}, but R2_PUBLIC_URL is ${publicBase.href}. ` +
          "Use the base the deployment serves covers from (and migrate the stored URLs first if it moved); nothing was changed.",
      );
    }
    return;
  }
  if (!expectedBase) {
    throw new CoverReplacementRefusedError(
      `The edition has no cover to check R2_PUBLIC_URL (${publicBase.href}) against. Confirm that it is the base the ` +
        `deployment serves covers from and pass --expect-base ${publicBase.href}; nothing was changed.`,
    );
  }
}

export function planCoverReplacement({
  edition,
  expectedBook,
  data,
  image,
  publicBase,
  expectedBase,
}: {
  edition: ReplacementEdition;
  /** The book slug the operator expects; a mismatch means the wrong Gutenberg id and stops the run. */
  expectedBook: string;
  data: Buffer;
  image: Pick<CoverImage, "extension">;
  publicBase: MediaBase;
  /** --expect-base; required when the edition has no cover (see verifyPublicBase). */
  expectedBase?: MediaBase;
}): CoverReplacementPlan {
  if (edition.bookSlug !== expectedBook) {
    throw new CoverReplacementRefusedError(
      `The edition belongs to book "${edition.bookSlug}", not "${expectedBook}"; nothing was changed.`,
    );
  }
  verifyPublicBase({ publicBase, currentCoverUrl: edition.coverUrl, expectedBase });

  const key = coverKeyFor({
    bookSlug: edition.bookSlug,
    gutenbergId: edition.sourceIdentifier,
    data,
    extension: image.extension,
    custom: true,
  });
  const url = `${publicBase.href}/${key}`;

  return { editionId: edition.id, key, url, previousUrl: edition.coverUrl, unchanged: edition.coverUrl === url };
}

export interface CoverReplacementDependencies {
  /** Stores the image in R2 and returns its public URL; uploadCover in r2.ts outside tests. */
  upload: (input: {
    bookSlug: string;
    gutenbergId: string;
    data: Buffer;
    mediaType: string;
    extension: string;
    custom: true;
  }) => Promise<string>;
  /**
   * Runs `write` in one transaction with the edition's row locked (SELECT … FOR UPDATE). `update` sets cover_url only
   * where it still holds `previousUrl` and returns the number of rows changed. A throw rolls the transaction back.
   */
  withLockedEdition: (
    write: (
      edition: ReplacementEdition,
      update: (url: string, previousUrl: string | null) => Promise<number>,
    ) => Promise<void>,
  ) => Promise<void>;
  revalidate: (tags: string[]) => Promise<boolean>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

/**
 * The --apply half of a replacement, with its side effects injected. Order: the anchor check, the upload, the locked
 * write, then the cache.
 *
 * - `expectedCurrent` (--expect-current) must be the stored cover, checked before the upload and again under the lock:
 *   a cover that changed since the dry run is never overwritten, and nothing is uploaded, written or invalidated.
 * - A plan whose edition already shows this exact image (its URL is derived from these bytes, this book and this
 *   Gutenberg id) uploads and writes nothing and only refreshes the cache: it is the rerun after a commit whose outcome
 *   was unknown, and the stored URL is the intended one, so no unexpected change can hide behind it.
 * - A failed upload writes nothing. A refused check inside the transaction rolls it back: the uploaded object stays
 *   unreferenced. Any other failure of the write may have happened after the commit: the message says the object may
 *   be referenced, and running the command again tells which (already applied, or a retry with the same key).
 */
export async function applyCoverReplacement(
  {
    plan,
    edition,
    expectedBook,
    expectedCurrent,
    data,
    image,
    publicBase,
    expectedBase,
  }: {
    plan: CoverReplacementPlan;
    edition: ReplacementEdition;
    expectedBook: string;
    /** --expect-current: the stored cover URL the operator reviewed, or null for none. */
    expectedCurrent: string | null;
    data: Buffer;
    image: Pick<CoverImage, "extension" | "mediaType">;
    publicBase: MediaBase;
    expectedBase?: MediaBase;
  },
  { upload, withLockedEdition, revalidate, log = console.log, error = console.error }: CoverReplacementDependencies,
): Promise<"applied" | "unchanged"> {
  const tags = ["library", `book:${edition.bookSlug}`];
  const refresh = async () => {
    const invalidated = await revalidate(tags);
    log(invalidated ? "Editorial cache invalidated." : "WARNING: editorial cache not invalidated; see above.");
  };

  if (plan.unchanged) {
    log("The edition already shows this image; nothing to upload or write.");
    await refresh();
    return "unchanged";
  }

  if (plan.previousUrl !== expectedCurrent) {
    throw new CoverReplacementRefusedError(
      `The current cover is ${expectCurrentArgument(plan.previousUrl)}, not the expected ` +
        `${expectCurrentArgument(expectedCurrent)}; it changed since the dry run. Nothing was uploaded or written.`,
    );
  }

  const uploaded = await upload({
    bookSlug: edition.bookSlug,
    gutenbergId: edition.sourceIdentifier,
    data,
    mediaType: image.mediaType,
    extension: image.extension,
    custom: true,
  });
  if (uploaded !== plan.url) {
    throw new CoverReplacementRefusedError(
      `R2 returned ${uploaded}, expected ${plan.url}; the database was not changed.`,
    );
  }
  log(`Uploaded: ${uploaded}`);

  try {
    await withLockedEdition(async (locked, update) => {
      const again = planCoverReplacement({ edition: locked, expectedBook, data, image, publicBase, expectedBase });
      if (again.editionId !== plan.editionId || again.previousUrl !== expectedCurrent) {
        throw new CoverReplacementRefusedError(
          "The edition's cover changed since it was read; rolled back, nothing was written.",
        );
      }
      const count = await update(plan.url, expectedCurrent);
      if (count !== 1) {
        throw new CoverReplacementRefusedError(`Updated ${count} rows instead of 1; rolled back, nothing was written.`);
      }
    });
  } catch (cause) {
    if (cause instanceof CoverReplacementRefusedError) {
      error(`Nothing was written; ${uploaded} is in R2 and no edition references it.`);
    } else {
      // The failure may have come after the commit reached the server (a connection lost during COMMIT).
      error(
        `The database write did not confirm: ${uploaded} is in R2 and the edition may or may not reference it, ` +
          "depending on whether the commit reached the database.",
      );
      error(
        "Run the same command again to confirm the state: it reports that the edition already shows the image, or " +
          "retries the write, re-uploading the same bytes to the same key.",
      );
    }
    throw cause;
  }
  log("Updated editions.cover_url.");

  await refresh();
  return "applied";
}
