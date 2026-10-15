// Snapshot of what the database currently holds for one Gutenberg source. The importer plans against
// this, both in a read-only dry run and again, under lock, immediately before writing.

export interface BookRecord {
  id: string;
  slug: string;
}

export interface AuthorRecord {
  id: string;
  slug: string;
  name: string;
}

export interface EditionRecord {
  id: string;
  bookId: string;
  slug: string;
  language: string;
  title: string;
  translator: string | null;
  publicationYear: number | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  copyrightStatus: string;
  publicationStatus: string;
}

export interface ChapterRecord {
  id: string;
  number: number;
  slug: string;
  title: string;
  content: string;
  wordCount: number | null;
}

export interface EditionState {
  /** Book with the requested slug, if it exists. */
  book: BookRecord | null;
  /** Authors already linked to `book`. */
  bookAuthors: AuthorRecord[];
  /** Existing authors whose slug matches one of the EPUB creators. */
  creatorAuthors: AuthorRecord[];
  /** Edition created from this Gutenberg source, if it exists. */
  edition: EditionRecord | null;
  chapters: ChapterRecord[];
  /** Chapters (of `edition`) that at least one reader has saved progress in. */
  progressChapterIds: string[];
  /**
   * Saved positions (no user identifiers), locked for update. Only filled when the state is read for a write,
   * where the importer must remap them after a content change; a dry run needs just `progressChapterIds`.
   */
  progressRows: { id: string; chapterId: string; paragraphIndex: number; percentage: number }[];
}

export interface StateRequest {
  bookSlug: string;
  gutenbergId: string;
  creatorSlugs: string[];
}

/** Thrown when a plan violates an import policy. Nothing has been written when this is raised. */
export class ImportBlockedError extends Error {
  constructor(readonly violations: string[]) {
    super(`Import blocked:\n${violations.map((violation) => `  - ${violation}`).join("\n")}`);
    this.name = "ImportBlockedError";
  }
}
