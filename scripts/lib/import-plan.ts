import { createHash } from "node:crypto";

import { isLocalDatabase } from "../../src/db/tls";

import { matchChapters } from "./reimport-chapters";
import type { ChapterRecord, EditionState } from "./import-state";

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
  };
}

export interface ChapterChange {
  kind: "new" | "unchanged" | "modified";
  incoming: IncomingChapter;
  existing?: ChapterRecord;
  /** What differs from the stored chapter. Empty for `new` and `unchanged`. */
  changes: ("title" | "slug" | "number" | "content")[];
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
  chapters: ChapterChange[];
  removed: RemovedChapter[];
  orderChanged: boolean;
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
    removedWithProgress: number;
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

    return { kind: changes.length ? "modified" : "unchanged", incoming, existing, changes };
  });

  const matchedNumbers = chapters.flatMap((change) => (change.existing ? [change.existing.number] : []));
  const orderChanged = matchedNumbers.some((number, index) => index > 0 && number < matchedNumbers[index - 1]);

  const metadata: MetadataChange[] = [];
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
    if (input.incoming.coverKey && !edition.coverUrl?.endsWith(`/${input.incoming.coverKey}`)) {
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
    removedWithProgress: removed.filter((chapter) => progress.has(chapter.id)).length,
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
    totals,
    hasChanges:
      !edition ||
      totals.new > 0 ||
      totals.modified > 0 ||
      totals.removed > 0 ||
      metadata.length > 0 ||
      authors.length > 0,
  };
}

/**
 * Fingerprint of "this EPUB against this exact database state". A plan reviewed in a dry run can only be
 * applied if the digest recomputed under lock at write time is identical.
 */
export function computePlanDigest(state: EditionState, input: PlanInput, diff: ImportDiff): string {
  return sha256(
    JSON.stringify({
      v: 2,
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
        ]),
      },
      authors: diff.authors.map((author) => [author.slug, author.name, author.action]),
      existing: [...state.chapters]
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((chapter) => [chapter.id, chapter.number, chapter.slug, chapter.title, sha256(chapter.content)]),
      progress: [...state.progressChapterIds].sort(),
      metadata: diff.metadata,
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
      `The EPUB extraction raised ${extractionWarnings.length} warning(s) that need a human decision; review them and pass --accept-warnings.`,
    );
  }

  if (diff.attachesToExistingBook && !slugWasExplicit) {
    violations.push(
      `The slug "${diff.bookSlug}" was derived from the EPUB title and belongs to an existing book; pass --slug explicitly to add this source as another edition of it.`,
    );
  }

  if (diff.keptAuthors === 0 && diff.authors.length === 0) {
    violations.push(
      "The EPUB names no creator and the book has no authors: the catalog only lists books with an author, so it would never appear.",
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
      `  Changes: ${totals.titleChanges} title, ${totals.slugChanges} slug/URL, ${totals.numberChanges} order number, ${totals.contentChanges} content${diff.orderChanged ? "; the relative order of existing chapters changed" : ""}.`,
    );
  }

  for (const change of diff.metadata) {
    lines.push(`  Metadata ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
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
