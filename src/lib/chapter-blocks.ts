// Structured chapter content: typed editorial blocks extracted from an EPUB's XHTML, never HTML. A chapter keeps its
// plain `content` too, derived from these blocks: every text block is exactly one paragraph of that text, in order,
// while figures and separators add none, so word counts, chapter matching and saved reading positions (paragraph
// indexes) keep working on the same text. Version 1 references images by their path inside the EPUB archive; the
// application does not render blocks yet.

export const CHAPTER_BLOCKS_VERSION = 1;

/** Inline formatting, in canonical order. */
export const INLINE_MARKS = ["em", "strong", "sup", "sub", "smallCaps"] as const;
export type InlineMark = (typeof INLINE_MARKS)[number];

/** A run of text with the same formatting. `marks` is omitted when there is none. */
export interface InlineText {
  text: string;
  marks?: InlineMark[];
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Raster formats an illustration may have; anything else stays out of a figure's image. */
export const FIGURE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type FigureMediaType = (typeof FIGURE_MEDIA_TYPES)[number];

/** The longest image path a figure may have: the limit of edition_assets.source_path. */
export const MAX_IMAGE_PATH_LENGTH = 1024;

export interface FigureImage {
  /** Normalized path of the image inside the EPUB archive: relative, never a URL, never leaving the archive. */
  path: string;
  /** Detected from the file's bytes, not from the manifest. */
  mediaType: FigureMediaType;
}

export type TextBlock =
  | { type: "paragraph"; content: InlineText[] }
  | { type: "heading"; level: HeadingLevel; content: InlineText[] }
  | { type: "listItem"; ordered: boolean; content: InlineText[] }
  | { type: "quote"; content: InlineText[] }
  /** Lines of verse (or any paragraph broken with <br/>), in order; joined by a space in the plain text. */
  | { type: "verse"; lines: InlineText[][] };

export type ChapterBlock =
  | TextBlock
  | { type: "separator" }
  | {
      type: "figure";
      /** Null when the image cannot be used (missing, external, unsupported): alt and caption are still kept. */
      image: FigureImage | null;
      alt: string;
      width?: number;
      height?: number;
      caption: InlineText[];
    };

export interface ChapterBlocks {
  version: typeof CHAPTER_BLOCKS_VERSION;
  blocks: ChapterBlock[];
}

function markOrder(mark: InlineMark) {
  return INLINE_MARKS.indexOf(mark);
}

const sameMarks = (first: readonly InlineMark[] = [], second: readonly InlineMark[] = []) =>
  first.length === second.length && first.every((mark, index) => mark === second[index]);

/** Canonical form of a set of marks: unique and in INLINE_MARKS order. */
export function canonicalMarks(marks: Iterable<InlineMark>): InlineMark[] {
  return [...new Set(marks)].sort((first, second) => markOrder(first) - markOrder(second));
}

/**
 * Collapses whitespace exactly as the plain-text extraction does (non-breaking spaces become spaces, any run of
 * whitespace becomes one space, the ends are trimmed) while keeping each character's formatting. A collapsed space
 * keeps the formatting of the first whitespace it replaces, so "<i>word</i> next" leaves the space outside the
 * italics. Adjacent runs with the same marks are merged and empty runs dropped.
 */
export function normalizeInline(runs: readonly InlineText[]): InlineText[] {
  const output: InlineText[] = [];
  let pendingSpace: readonly InlineMark[] | undefined | null = null;

  const append = (text: string, marks: readonly InlineMark[] | undefined) => {
    const last = output.at(-1);
    if (last && sameMarks(last.marks, marks)) last.text += text;
    else output.push(marks?.length ? { text, marks: [...marks] } : { text });
  };

  for (const run of runs) {
    const text = run.text.replace(/&nbsp;| /g, " ");
    let word = "";
    for (const character of text) {
      if (/\s/.test(character)) {
        if (word) append(word, run.marks);
        word = "";
        if (pendingSpace === null) pendingSpace = run.marks;
        continue;
      }
      // `word` is empty here: whitespace always flushes it. Leading whitespace is dropped (nothing precedes it).
      if (pendingSpace !== null && output.length > 0) append(" ", pendingSpace);
      pendingSpace = null;
      word += character;
    }
    if (word) append(word, run.marks);
  }
  return output;
}

export const inlinePlainText = (content: readonly InlineText[]) => content.map((run) => run.text).join("");

/** The paragraph a block contributes to the chapter's plain text, or null for figures and separators. */
export function blockPlainText(block: ChapterBlock): string | null {
  switch (block.type) {
    case "figure":
    case "separator":
      return null;
    case "verse":
      return block.lines.map(inlinePlainText).join(" ");
    default:
      return inlinePlainText(block.content);
  }
}

/** The chapter's plain text: one paragraph per text block, separated by a blank line. */
export function deriveChapterContent(blocks: readonly ChapterBlock[]): string {
  return blocks
    .map(blockPlainText)
    .filter((text): text is string => text !== null)
    .join("\n\n");
}

/* Validation: everything stored or rendered goes through parseChapterBlocks, which accepts only the shapes above. */

function fail(path: string, message: string): never {
  throw new Error(`Invalid chapter blocks at ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(path, `unknown field ${unknown.join(", ")}`);
}

function parseInline(value: unknown, path: string, allowEmpty = false): InlineText[] {
  if (!Array.isArray(value)) fail(path, "expected a list of text runs");
  const runs = value.map((run, index): InlineText => {
    const runPath = `${path}[${index}]`;
    if (!isRecord(run)) fail(runPath, "expected a text run");
    assertKeys(run, ["text", "marks"], runPath);
    if (typeof run.text !== "string" || !run.text) fail(runPath, "text must be a non-empty string");
    if (run.marks === undefined) return { text: run.text };
    if (!Array.isArray(run.marks) || run.marks.length === 0) fail(runPath, "marks must be a non-empty list");
    for (const mark of run.marks) {
      if (!INLINE_MARKS.includes(mark as InlineMark)) fail(runPath, `unknown mark ${JSON.stringify(mark)}`);
    }
    const marks = run.marks as InlineMark[];
    if (!sameMarks(marks, canonicalMarks(marks))) fail(runPath, "marks must be unique and in canonical order");
    return { text: run.text, marks };
  });
  const text = inlinePlainText(runs);
  if (!text && !allowEmpty) fail(path, "text is empty");
  // Normalized text only: one space between words, nothing at the ends, no line breaks.
  if (text !== text.replace(/\s+/g, " ").trim()) fail(path, "text is not whitespace-normalized");
  return runs;
}

function parseImage(value: unknown, path: string): FigureImage | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(path, "expected an image or null");
  assertKeys(value, ["path", "mediaType"], path);
  const { path: imagePath, mediaType } = value;
  if (
    typeof imagePath !== "string" ||
    !imagePath ||
    /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(imagePath) ||
    imagePath.includes("\\") ||
    imagePath.includes("\0") ||
    imagePath.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    fail(path, "path must be a normalized relative path inside the archive");
  }
  // Counted in characters, as PostgreSQL's length() counts them in edition_assets_source_path_check.
  if ([...imagePath].length > MAX_IMAGE_PATH_LENGTH)
    fail(path, `path is longer than ${MAX_IMAGE_PATH_LENGTH} characters`);
  if (!FIGURE_MEDIA_TYPES.includes(mediaType as FigureMediaType)) fail(path, "unsupported media type");
  return { path: imagePath, mediaType: mediaType as FigureMediaType };
}

function parseDimension(value: unknown, path: string) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 100_000) {
    fail(path, "must be a positive integer");
  }
  return value as number;
}

export function parseChapterBlock(value: unknown, path = "block"): ChapterBlock {
  if (!isRecord(value)) fail(path, "expected a block");
  switch (value.type) {
    case "paragraph":
    case "quote":
      assertKeys(value, ["type", "content"], path);
      return { type: value.type, content: parseInline(value.content, `${path}.content`) };
    case "heading": {
      assertKeys(value, ["type", "level", "content"], path);
      const level = value.level;
      if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6) fail(path, "level must be 1–6");
      return { type: "heading", level: level as HeadingLevel, content: parseInline(value.content, `${path}.content`) };
    }
    case "listItem":
      assertKeys(value, ["type", "ordered", "content"], path);
      if (typeof value.ordered !== "boolean") fail(path, "ordered must be a boolean");
      return { type: "listItem", ordered: value.ordered, content: parseInline(value.content, `${path}.content`) };
    case "verse": {
      assertKeys(value, ["type", "lines"], path);
      if (!Array.isArray(value.lines) || value.lines.length === 0) fail(path, "expected at least one line");
      return { type: "verse", lines: value.lines.map((line, index) => parseInline(line, `${path}.lines[${index}]`)) };
    }
    case "separator":
      assertKeys(value, ["type"], path);
      return { type: "separator" };
    case "figure": {
      assertKeys(value, ["type", "image", "alt", "width", "height", "caption"], path);
      if (typeof value.alt !== "string" || value.alt !== value.alt.replace(/\s+/g, " ").trim()) {
        fail(path, "alt must be a whitespace-normalized string");
      }
      const width = parseDimension(value.width, `${path}.width`);
      const height = parseDimension(value.height, `${path}.height`);
      return {
        type: "figure",
        image: parseImage(value.image, `${path}.image`),
        alt: value.alt,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        caption: parseInline(value.caption, `${path}.caption`, true),
      };
    }
    default:
      return fail(path, `unknown block type ${JSON.stringify(value.type)}`);
  }
}

/** Validates stored or extracted blocks; throws, naming the position, on anything outside the schema. */
export function parseChapterBlocks(value: unknown): ChapterBlocks {
  if (!isRecord(value)) fail("root", "expected an object");
  assertKeys(value, ["version", "blocks"], "root");
  if (value.version !== CHAPTER_BLOCKS_VERSION) fail("root", `unsupported version ${JSON.stringify(value.version)}`);
  if (!Array.isArray(value.blocks)) fail("root", "blocks must be a list");
  return {
    version: CHAPTER_BLOCKS_VERSION,
    blocks: value.blocks.map((block, index) => parseChapterBlock(block, `blocks[${index}]`)),
  };
}

/* Storage: chapters.blocks (jsonb, nullable) next to chapters.content. */

/**
 * The blocks to write with a chapter: validated against the schema, and refused unless they derive exactly the
 * chapter's `content`, so saved reading positions (paragraph indexes of `content`) keep meaning the same paragraphs.
 */
export function chapterBlocksForStorage(value: unknown, content: string): ChapterBlocks {
  const blocks = parseChapterBlocks(value);
  if (deriveChapterContent(blocks.blocks) !== content) {
    throw new Error("Invalid chapter blocks: they do not derive the chapter's content");
  }
  return blocks;
}

export type StoredChapterBlocks =
  | { status: "blocks"; blocks: ChapterBlocks }
  /** No blocks stored: a chapter imported before blocks existed. */
  | { status: "absent" }
  /** Stored but unusable (outside the schema, or no longer matching `content`); the reason is for logs only. */
  | { status: "invalid"; reason: string };

/**
 * How to read a chapter's stored blocks. Only valid blocks that still derive `content` are used; anything else is
 * read from `content` exactly as before blocks existed, so a chapter is never left without text.
 */
export function readStoredChapterBlocks(value: unknown, content: string): StoredChapterBlocks {
  if (value === null || value === undefined) return { status: "absent" };
  try {
    return { status: "blocks", blocks: chapterBlocksForStorage(value, content) };
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
}

/* Writing: every write of chapters.content goes through ChapterText. */

/** Words in a chapter's plain text, as stored in chapters.word_count. */
export function countChapterWords(content: string) {
  const clean = content.trim();
  return clean ? clean.split(/\s+/).length : 0;
}

/**
 * The text columns of one chapter write: `content`, `word_count` and `blocks`, always written together, so new text is
 * never stored next to blocks derived from an older one. Only the two constructors make one: `withBlocks` validates
 * untrusted blocks with chapterBlocksForStorage (schema, version, marks, image paths, and the exact text they derive),
 * and `textOnly` stores a chapter without blocks, writing NULL explicitly. Nothing turns invalid blocks into valid ones
 * or invents blocks for a text: invalid blocks throw.
 */
export class ChapterText {
  readonly #content: string;
  readonly #blocks: ChapterBlocks | null;

  private constructor(content: string, blocks: ChapterBlocks | null) {
    this.#content = content;
    this.#blocks = blocks;
  }

  /** Text with its blocks. Throws when the blocks are outside the schema or do not derive exactly `content`. */
  static withBlocks(content: string, blocks: unknown): ChapterText {
    if (blocks === null || blocks === undefined) {
      throw new Error("Invalid chapter blocks: none given; use ChapterText.textOnly for a chapter without blocks");
    }
    return new ChapterText(content, chapterBlocksForStorage(blocks, content));
  }

  /** Text without blocks, as chapters had before blocks existed; `blocks` is written as NULL. */
  static textOnly(content: string): ChapterText {
    return new ChapterText(content, null);
  }

  get content() {
    return this.#content;
  }

  get blocks() {
    return this.#blocks;
  }

  get wordCount() {
    return countChapterWords(this.#content);
  }

  /** The columns to write, the three of them: spread into the values or the set of a chapter write. */
  columns(): { content: string; wordCount: number; blocks: ChapterBlocks | null } {
    return { content: this.#content, wordCount: this.wordCount, blocks: this.#blocks };
  }
}
