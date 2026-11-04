import { createHash } from "node:crypto";

import { isLocalDatabase } from "../../src/db/tls";

import { readStoredChapterBlocks, type ChapterBlocks } from "../../src/lib/chapter-blocks";

import { isCustomCoverUrl } from "./custom-cover";
import { matchChapters } from "./reimport-chapters";
import type { ChapterRecord, EditionAssetRecord, EditionState } from "./import-state";

export const BOOK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_BOOK_SLUG_LENGTH = 251;

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeCreatorName(value: string) {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  return value.trim();
}

export function isValidBookSlug(value: string) {
  return value.length > 0 && value.length <= MAX_BOOK_SLUG_LENGTH && BOOK_SLUG_PATTERN.test(value);
}

export interface IncomingChapter {
  number: number;
  slug: string;
  title: string;
  content: string;
  wordCount: number;
  /** Typed blocks extracted from the EPUB; written with `content` through ChapterText. */
  blocks: ChapterBlocks;
}

/** A normalized image the edition will use, as the plan sees it (the bytes stay with the importer). */
export interface PlannedImage {
  sourcePath: string;
  sourceSha256: string;
  codecId: string;
  maxWidth: number;
  sha256: string;
  key: string;
  mediaType: string;
  width: number;
  height: number;
  bytes: number;
}

export interface PlanInput {
  bookSlug: string;
  /** False when the slug was derived from the EPUB title instead of passed explicitly. */
  slugWasExplicit: boolean;
  gutenbergId: string;
  /** SHA-256 of the EPUB bytes: ties a reviewed plan to exactly one file. */
  epubSha256: string;
  editionPublicationYear?: number;
  incoming: {
    title: string;
    language: string;
    translator: string | null;
    creators: string[];
    /** Object key the cover would be stored under, or null when the EPUB has no usable cover. */
    coverKey: string | null;
    chapters: IncomingChapter[];
    /** The normalized image of every figure with an image, one per source path. */
    images: PlannedImage[];
  };
  /** Every warning that needs a human decision: the extractor's and the unusable images'. */
  warnings: string[];
  /**
   * --replace-custom-cover: let the EPUB's cover replace a cover made for Libra (under covers/libra/). Without it, a
   * stored custom cover is always kept.
   */
  replaceCustomCover?: boolean;
}

export interface ChapterChange {
  kind: "new" | "unchanged" | "modified";
  incoming: IncomingChapter;
  existing?: ChapterRecord;
  /** What differs from the stored chapter. Empty for `new` and `unchanged`. */
  changes: ("title" | "slug" | "number" | "content" | "blocks")[];
}

/** One source path of the edition's images: what the import would associate with it, against what it has. */
export interface ImageChange {
  sourcePath: string;
  kind: "new" | "changed" | "unchanged" | "removed";
  incoming?: PlannedImage;
  existing?: EditionAssetRecord;
}

export interface RemovedChapter {
  id: string;
  number: number;
  slug: string;
  title: string;
  words: number;
  hasProgress: boolean;
}

export interface MetadataChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

export interface AuthorPlan {
  slug: string;
  name: string;
  action: "create" | "reuse";
  /** For `reuse`: the stored name, which is never overwritten by the import. */
  existingName?: string;
}

export interface ImportDiff {
  bookSlug: string;
  gutenbergId: string;
  book: { exists: boolean };
  edition: { exists: boolean; id?: string; publicationStatus?: string; copyrightStatus?: string };
  /** A new source edition would be attached to a book that already exists. */
  attachesToExistingBook: boolean;
  authors: AuthorPlan[];
  keptAuthors: number;
  metadata: MetadataChange[];
  /**
   * The edition's stored cover when it is a cover made for Libra, and what the plan does with it: `kept` (no `cover`
   * change, whatever the EPUB has) or `replaced` (by the EPUB's, with --replace-custom-cover). Null otherwise.
   */
  customCover: { url: string; action: "kept" | "replaced" } | null;
  chapters: ChapterChange[];
  removed: RemovedChapter[];
  orderChanged: boolean;
  /** Every source path the import would associate or dissociate, sorted. */
  images: ImageChange[];
  totals: {
    incoming: number;
    new: number;
    unchanged: number;
    modified: number;
    removed: number;
    titleChanges: number;
    slugChanges: number;
    numberChanges: number;
    contentChanges: number;
    blocksChanges: number;
    removedWithProgress: number;
    imagesNew: number;
    imagesChanged: number;
    imagesUnchanged: number;
    imagesRemoved: number;
  };
  /** False when applying the plan would write nothing. */
  hasChanges: boolean;
}

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON with object keys sorted at every level: the same value always gives the same text, whatever its key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0)),
        )
      : item,
  );
}

/** Digest of stored blocks as they are (null when there are none), independent of how jsonb ordered the keys. */
function storedBlocksDigest(blocks: unknown) {
  return blocks === null || blocks === undefined ? null : sha256(canonicalJson(blocks));
}

/** Stored blocks equal the incoming ones only when they are valid, still derive the stored text, and match. */
function sameBlocks(existing: ChapterRecord, incoming: IncomingChapter) {
  const stored = readStoredChapterBlocks(existing.blocks, existing.content);
  return stored.status === "blocks" && canonicalJson(stored.blocks) === canonicalJson(incoming.blocks);
}

/** The association is unchanged only when it points at an asset of the same identity and the same bytes. */
function sameImage(existing: EditionAssetRecord, incoming: PlannedImage) {
  return (
    existing.sourceSha256 === incoming.sourceSha256 &&
    existing.codecId === incoming.codecId &&
    existing.maxWidth === incoming.maxWidth &&
    existing.sha256 === incoming.sha256 &&
    existing.objectKey === incoming.key &&
    existing.mediaType === incoming.mediaType &&
    existing.width === incoming.width &&
    existing.height === incoming.height &&
    existing.byteSize === incoming.bytes
  );
}

const byPath = (first: { sourcePath: string }, second: { sourcePath: string }) =>
  first.sourcePath < second.sourcePath ? -1 : first.sourcePath > second.sourcePath ? 1 : 0;

export function buildImageChanges(existing: readonly EditionAssetRecord[], incoming: readonly PlannedImage[]) {
  const stored = new Map(existing.map((asset) => [asset.sourcePath, asset]));
  const wanted = new Map(incoming.map((image) => [image.sourcePath, image]));
  const changes: ImageChange[] = [];
  for (const image of wanted.values()) {
    const asset = stored.get(image.sourcePath);
    changes.push(
      !asset
        ? { sourcePath: image.sourcePath, kind: "new", incoming: image }
        : {
            sourcePath: image.sourcePath,
            kind: sameImage(asset, image) ? "unchanged" : "changed",
            incoming: image,
            existing: asset,
          },
    );
  }
  for (const asset of stored.values()) {
    if (!wanted.has(asset.sourcePath)) changes.push({ sourcePath: asset.sourcePath, kind: "removed", existing: asset });
  }
  return changes.sort(byPath);
}

export function buildImportDiff(state: EditionState, input: PlanInput): ImportDiff {
  const { edition, book } = state;

  if (edition && edition.bookId !== book?.id) {
    throw new Error(
      "This Gutenberg source already belongs to another book; reparenting requires an explicit migration.",
    );
  }

  const { chapters: matched, removed } = matchChapters(state.chapters, input.incoming.chapters);
  const progress = new Set(state.progressChapterIds);

  const chapters: ChapterChange[] = matched.map(({ existing, ...incoming }) => {
    if (!existing) return { kind: "new", incoming, changes: [] };

    const changes: ChapterChange["changes"] = [];
    if (existing.title !== incoming.title) changes.push("title");
    if (existing.slug !== incoming.slug) changes.push("slug");
    if (existing.number !== incoming.number) changes.push("number");
    if (existing.content !== incoming.content) changes.push("content");
    // Also when the text is the same: blocks added to a chapter imported before blocks existed, or new formatting.
    if (!sameBlocks(existing, incoming)) changes.push("blocks");

    return { kind: changes.length ? "modified" : "unchanged", incoming, existing, changes };
  });
  const images = buildImageChanges(state.assets, input.incoming.images);

  const matchedNumbers = chapters.flatMap((change) => (change.existing ? [change.existing.number] : []));
  const orderChanged = matchedNumbers.some((number, index) => index > 0 && number < matchedNumbers[index - 1]);

  const metadata: MetadataChange[] = [];
  let customCover: ImportDiff["customCover"] = null;
  if (edition) {
    const expectedSlug = `${input.incoming.language}-gutenberg-${input.gutenbergId}`;
    const sourceUrl = `https://www.gutenberg.org/ebooks/${input.gutenbergId}`;
    const compare = (field: string, from: MetadataChange["from"], to: MetadataChange["to"]) => {
      if (from !== to) metadata.push({ field, from, to });
    };

    compare("title", edition.title, input.incoming.title);
    compare("language", edition.language, input.incoming.language);
    compare("slug", edition.slug, expectedSlug);
    compare("translator", edition.translator, input.incoming.translator);
    compare("sourceUrl", edition.sourceUrl, sourceUrl);
    if (input.editionPublicationYear !== undefined) {
      compare("publicationYear", edition.publicationYear, input.editionPublicationYear);
    }
    // A cover made for Libra is never restored to the EPUB's by a re-import: only an explicit --replace-custom-cover
    // (and an EPUB that has a cover) turns it into a `cover` change.
    const replacesCustom = Boolean(input.replaceCustomCover && input.incoming.coverKey);
    if (edition.coverUrl && isCustomCoverUrl(edition.coverUrl)) {
      customCover = { url: edition.coverUrl, action: replacesCustom ? "replaced" : "kept" };
    }
    if (
      input.incoming.coverKey &&
      !edition.coverUrl?.endsWith(`/${input.incoming.coverKey}`) &&
      customCover?.action !== "kept"
    ) {
      metadata.push({ field: "cover", from: edition.coverUrl, to: input.incoming.coverKey });
    }
  }

  const authors: AuthorPlan[] = [];
  if (state.bookAuthors.length === 0) {
    const seen = new Set<string>();
    for (const rawCreator of input.incoming.creators) {
      const name = normalizeCreatorName(rawCreator);
      const slug = slugify(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const existing = state.creatorAuthors.find((author) => author.slug === slug);
      authors.push(
        existing ? { slug, name, action: "reuse", existingName: existing.name } : { slug, name, action: "create" },
      );
    }
  }

  const totals = {
    incoming: chapters.length,
    new: chapters.filter((change) => change.kind === "new").length,
    unchanged: chapters.filter((change) => change.kind === "unchanged").length,
    modified: chapters.filter((change) => change.kind === "modified").length,
    removed: removed.length,
    titleChanges: chapters.filter((change) => change.changes.includes("title")).length,
    slugChanges: chapters.filter((change) => change.changes.includes("slug")).length,
    numberChanges: chapters.filter((change) => change.changes.includes("number")).length,
    contentChanges: chapters.filter((change) => change.changes.includes("content")).length,
    blocksChanges: chapters.filter((change) => change.changes.includes("blocks")).length,
    removedWithProgress: removed.filter((chapter) => progress.has(chapter.id)).length,
    imagesNew: images.filter((change) => change.kind === "new").length,
    imagesChanged: images.filter((change) => change.kind === "changed").length,
    imagesUnchanged: images.filter((change) => change.kind === "unchanged").length,
    imagesRemoved: images.filter((change) => change.kind === "removed").length,
  };

  return {
    bookSlug: input.bookSlug,
    gutenbergId: input.gutenbergId,
    book: { exists: Boolean(book) },
    edition: edition
      ? {
          exists: true,
          id: edition.id,
          publicationStatus: edition.publicationStatus,
          copyrightStatus: edition.copyrightStatus,
        }
      : { exists: false },
    attachesToExistingBook: !edition && Boolean(book),
    authors,
    keptAuthors: state.bookAuthors.length,
    metadata,
    customCover,
    chapters,
    removed: removed.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      slug: chapter.slug,
      title: chapter.title,
      words: countWords(chapter.content),
      hasProgress: progress.has(chapter.id),
    })),
    orderChanged,
    images,
    totals,
    hasChanges:
      !edition ||
      totals.new > 0 ||
      totals.modified > 0 ||
      totals.removed > 0 ||
      totals.imagesNew > 0 ||
      totals.imagesChanged > 0 ||
      totals.imagesRemoved > 0 ||
      metadata.length > 0 ||
      authors.length > 0,
  };
}

/**
 * Fingerprint of "this EPUB against this exact database state". A plan reviewed in a dry run can only be
 * applied if the digest recomputed under lock at write time is identical. It covers the blocks and normalized images
 * that would be written (with the codec that normalized them), the images the edition has, the warnings and whether
 * they were accepted: accepting warnings is part of the reviewed plan, so the dry run that gives the digest to
 * approve takes the same --accept-warnings as the write. Lists are sorted, so their order never changes the digest.
 * The decision on a custom cover (kept or replaced) is part of it too: a digest reviewed with the cover kept does not
 * authorize a write that replaces it.
 */
export function computePlanDigest(
  state: EditionState,
  input: PlanInput,
  diff: ImportDiff,
  { acceptWarnings }: Pick<ImportFlags, "acceptWarnings">,
): string {
  return sha256(
    JSON.stringify({
      v: 4,
      gutenbergId: input.gutenbergId,
      bookSlug: input.bookSlug,
      editionId: state.edition?.id ?? null,
      publicationStatus: state.edition?.publicationStatus ?? null,
      epub: input.epubSha256,
      editionPublicationYear: input.editionPublicationYear ?? null,
      // What would be written, not only which file it came from: the same bytes parsed by a different version
      // of the parser are a different plan.
      incoming: {
        title: input.incoming.title,
        language: input.incoming.language,
        translator: input.incoming.translator,
        coverKey: input.incoming.coverKey,
        chapters: input.incoming.chapters.map((chapter) => [
          chapter.number,
          chapter.slug,
          chapter.title,
          sha256(chapter.content),
          sha256(canonicalJson(chapter.blocks)),
        ]),
        images: [...input.incoming.images]
          .sort(byPath)
          .map((image) => [
            image.sourcePath,
            image.sourceSha256,
            image.codecId,
            image.maxWidth,
            image.sha256,
            image.key,
            image.mediaType,
            image.width,
            image.height,
            image.bytes,
          ]),
      },
      authors: diff.authors.map((author) => [author.slug, author.name, author.action]),
      existing: [...state.chapters]
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((chapter) => [
          chapter.id,
          chapter.number,
          chapter.slug,
          chapter.title,
          sha256(chapter.content),
          storedBlocksDigest(chapter.blocks),
        ]),
      existingAssets: [...state.assets]
        .sort(byPath)
        .map((asset) => [
          asset.sourcePath,
          asset.assetId,
          asset.sourceSha256,
          asset.codecId,
          asset.maxWidth,
          asset.sha256,
        ]),
      progress: [...state.progressChapterIds].sort(),
      metadata: diff.metadata,
      customCover: diff.customCover ? [diff.customCover.url, diff.customCover.action] : null,
      warnings: [...input.warnings].sort(),
      acceptWarnings,
    }),
  ).slice(0, 20);
}

export interface ImportFlags {
  allowRemovals: boolean;
  allowSlugChanges: boolean;
  /** Authorizes modifying a PUBLISHED edition, only together with the digest of the reviewed plan. */
  revisePublished: boolean;
  planHash?: string;
  acceptWarnings: boolean;
}

export const defaultImportFlags: ImportFlags = {
  allowRemovals: false,
  allowSlugChanges: false,
  revisePublished: false,
  acceptWarnings: false,
};

function list(items: string[], limit = 6) {
  return items.length > limit
    ? `${items.slice(0, limit).join(", ")} and ${items.length - limit} more`
    : items.join(", ");
}

/**
 * Pure policy check shared by the dry run and the locked write. An empty result means the plan may be applied
 * with the given flags.
 */
export function evaluateImportPolicy({
  diff,
  digest,
  extractionWarnings,
  slugWasExplicit,
  flags,
}: {
  diff: ImportDiff;
  digest: string;
  extractionWarnings: readonly string[];
  slugWasExplicit: boolean;
  flags: ImportFlags;
}): string[] {
  const violations: string[] = [];

  if (extractionWarnings.length && !flags.acceptWarnings) {
    violations.push(
      `The EPUB extraction raised ${extractionWarnings.length} warning(s) that need a human decision; review them and pass --accept-warnings (to the dry run too, for the digest of the accepted plan).`,
    );
  }

  if (diff.attachesToExistingBook && !slugWasExplicit) {
    violations.push(
      `The slug "${diff.bookSlug}" was derived from the EPUB title and belongs to an existing book; pass --slug explicitly to add this source as another edition of it.`,
    );
  }

  const withProgress = diff.removed.filter((chapter) => chapter.hasProgress);
  if (withProgress.length) {
    violations.push(
      `Chapters with saved reading progress would be removed (${list(withProgress.map((chapter) => chapter.slug))}); the importer never deletes them. An explicit editorial mapping is required first.`,
    );
  }

  if (diff.removed.length && !flags.allowRemovals) {
    violations.push(
      `${diff.removed.length} existing chapter(s) would be removed (${list(diff.removed.map((chapter) => chapter.slug))}); review the plan and pass --allow-removals.`,
    );
  }

  const published = diff.edition.exists && diff.edition.publicationStatus === "PUBLISHED";

  if (published && diff.hasChanges) {
    if (!flags.revisePublished) {
      violations.push(
        `The edition is PUBLISHED and the plan changes it. A normal import never modifies published content; use pnpm import:gutenberg with --revise-published --plan-hash ${digest} after reviewing this plan.`,
      );
    } else if (flags.planHash !== digest) {
      violations.push(
        flags.planHash
          ? `--plan-hash ${flags.planHash} does not match the current plan (${digest}): the EPUB or the database changed since the review. Run the dry run again.`
          : `--revise-published requires --plan-hash ${digest}, the digest of the plan you reviewed.`,
      );
    }

    const renamed = diff.chapters.filter((change) => change.changes.includes("slug"));
    if (renamed.length && !flags.allowSlugChanges) {
      violations.push(
        `${renamed.length} published chapter URL(s) would change (${list(renamed.map((change) => `${change.existing?.slug} -> ${change.incoming.slug}`))}); pass --allow-slug-changes only if redirects or re-indexing are planned.`,
      );
    }
  }

  return violations;
}

const LIST_LIMIT = 25;

function capped(lines: string[]) {
  return lines.length > LIST_LIMIT
    ? [...lines.slice(0, LIST_LIMIT), `    ... and ${lines.length - LIST_LIMIT} more`]
    : lines;
}

export function formatImportDiff(diff: ImportDiff): string[] {
  const { totals } = diff;
  const lines = [
    `Book "${diff.bookSlug}": ${diff.book.exists ? "exists" : "will be created"}.`,
    diff.edition.exists
      ? `Edition (Gutenberg ${diff.gutenbergId}): exists, ${diff.edition.publicationStatus} / ${diff.edition.copyrightStatus}.`
      : `Edition (Gutenberg ${diff.gutenbergId}): new${diff.attachesToExistingBook ? ", attached to the existing book" : ""}; it enters as DRAFT / PENDING_REVIEW.`,
    `Chapters: ${totals.incoming} in the EPUB — ${totals.new} new, ${totals.unchanged} unchanged, ${totals.modified} modified; ${totals.removed} existing to remove.`,
  ];

  if (diff.edition.exists) {
    lines.push(
      `  Changes: ${totals.titleChanges} title, ${totals.slugChanges} slug/URL, ${totals.numberChanges} order number, ${totals.contentChanges} content, ${totals.blocksChanges} blocks${diff.orderChanged ? "; the relative order of existing chapters changed" : ""}.`,
    );
  }
  if (diff.images.length) {
    lines.push(
      `Images: ${totals.imagesNew} new, ${totals.imagesChanged} changed, ${totals.imagesUnchanged} unchanged, ${totals.imagesRemoved} to dissociate.`,
      ...capped(
        diff.images
          .filter((change) => change.kind !== "unchanged")
          .map((change) =>
            change.kind === "removed"
              ? `  - ${change.sourcePath}`
              : `  ${change.kind === "new" ? "+" : "~"} ${change.sourcePath} -> ${change.incoming?.key} (${change.incoming?.width}×${change.incoming?.height})`,
          ),
      ),
    );
  }

  for (const change of diff.metadata) {
    lines.push(`  Metadata ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
  }

  if (diff.customCover?.action === "kept") {
    lines.push(
      `Cover: custom cover kept (${diff.customCover.url}); pass --replace-custom-cover to use the EPUB's instead.`,
    );
  } else if (diff.customCover?.action === "replaced") {
    lines.push(`Cover: custom cover ${diff.customCover.url} will be replaced by the EPUB's (--replace-custom-cover).`);
  }

  if (diff.authors.length) {
    lines.push("Authors:");
    for (const author of diff.authors) {
      lines.push(
        author.action === "create"
          ? `  create "${author.name}" (${author.slug})`
          : `  reuse existing "${author.existingName}" (${author.slug})${author.existingName !== author.name ? ` — the EPUB says "${author.name}"; the stored name is kept` : ""}`,
      );
    }
  } else if (diff.keptAuthors) {
    lines.push(`Authors: the book already has ${diff.keptAuthors}; they are not touched.`);
  } else {
    // No author record is invented: the catalog shows the work as anonymous.
    lines.push("Authors: none; the EPUB names no creator, so the work is listed as anonymous.");
  }

  const added = diff.chapters.filter((change) => change.kind === "new");
  if (added.length) {
    lines.push(
      "New chapters:",
      ...capped(added.map((change) => `  + ${change.incoming.slug} — ${change.incoming.title}`)),
    );
  }

  const modified = diff.chapters.filter((change) => change.kind === "modified");
  if (modified.length) {
    lines.push(
      "Modified chapters:",
      ...capped(
        modified.map((change) => {
          const detail = change.changes.map((field) => {
            if (field === "slug") return `slug ${change.existing?.slug} -> ${change.incoming.slug}`;
            if (field === "title") return `title "${change.existing?.title}" -> "${change.incoming.title}"`;
            if (field === "number") return `number ${change.existing?.number} -> ${change.incoming.number}`;
            if (field === "blocks") return change.existing?.blocks == null ? "blocks added" : "blocks";
            return `content ${countWords(change.existing?.content ?? "")} -> ${change.incoming.wordCount} words`;
          });
          return `  ~ ${change.incoming.slug}: ${detail.join("; ")}`;
        }),
      ),
    );
  }

  if (diff.removed.length) {
    lines.push(
      "Chapters that would disappear:",
      ...capped(
        diff.removed.map(
          (chapter) =>
            `  - #${chapter.number} ${chapter.slug} — ${chapter.title} (${chapter.words} words${chapter.hasProgress ? ", HAS READING PROGRESS" : ""})`,
        ),
      ),
    );
  }

  if (!diff.hasChanges) lines.push("Nothing to write: the stored edition already matches the EPUB.");

  return lines;
}

export interface DatabaseTarget {
  /** Masked host: enough to recognize the server, never the full name. */
  host: string;
  role: string;
  /** Short value an operator must repeat with --confirm-database to authorize writes to this target. */
  token: string;
  isLocal: boolean;
}

function mask(value: string) {
  return value.length <= 5 ? `${value.slice(0, 1)}**` : `${value.slice(0, 3)}..${value.slice(-2)}`;
}

/** Describes a connection string without ever revealing the password or the full host. */
export function describeDatabaseTarget(connectionString: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The PostgreSQL connection string is not a valid URL.");
  }

  const isLocal = isLocalDatabase(connectionString);
  const user = decodeURIComponent(url.username);
  const [role, projectFromUser] = user.split(".");
  const projectFromHost = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)?.[1];
  const project = projectFromUser || projectFromHost;

  return {
    host: isLocal ? url.hostname : url.hostname.replace(/^[^.]+/, (label) => mask(label)),
    role: role || "(none)",
    token: isLocal ? "local" : mask(project ?? url.hostname.split(".")[0]),
    isLocal,
  };
}
