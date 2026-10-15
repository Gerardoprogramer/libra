import { createHash } from "node:crypto";

interface ChapterContent {
  slug: string;
  number: number;
  title: string;
  content: string;
  wordCount: number | null;
}
interface ExistingChapter extends ChapterContent {
  id: string;
}

function hash(content: string) {
  return createHash("sha256").update(content.replace(/\s+/g, " ").trim()).digest("hex");
}
function normalizedTitle(title: string) {
  return title.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Pairs incoming chapters with existing ones by identity (unique content, then unique unchanged title and
 * slug), never by chapter number: a new prologue shifts every number. Unmatched existing chapters are
 * `removed`. Pure: it neither writes nor decides whether a removal is acceptable.
 */
export function matchChapters<Incoming extends ChapterContent>(existing: ExistingChapter[], incoming: Incoming[]) {
  if (!incoming.length) throw new Error("Cannot replace an edition with no chapters.");
  if (
    new Set(incoming.map((chapter) => chapter.slug)).size !== incoming.length ||
    new Set(incoming.map((chapter) => chapter.number)).size !== incoming.length
  ) {
    throw new Error("Duplicate chapter slug or number in import.");
  }
  const matches = new Map<number, ExistingChapter>();
  const used = new Set<string>();
  const oldHashes = existing.map((chapter) => hash(chapter.content));
  const newHashes = incoming.map((chapter) => hash(chapter.content));
  for (const [index, fingerprint] of newHashes.entries()) {
    const candidates = existing.filter((_, oldIndex) => oldHashes[oldIndex] === fingerprint);
    if (candidates.length === 1 && newHashes.filter((value) => value === fingerprint).length === 1) {
      matches.set(index, candidates[0]);
      used.add(candidates[0].id);
    }
  }
  for (const [index, chapter] of incoming.entries()) {
    if (matches.has(index)) continue;
    const title = normalizedTitle(chapter.title);
    const candidate = existing.find((old) => old.slug === chapter.slug && !used.has(old.id));
    if (
      candidate &&
      normalizedTitle(candidate.title) === title &&
      existing.filter((old) => normalizedTitle(old.title) === title).length === 1 &&
      incoming.filter((next) => normalizedTitle(next.title) === title).length === 1
    ) {
      matches.set(index, candidate);
      used.add(candidate.id);
    }
  }
  return {
    chapters: incoming.map((chapter, index) => ({ ...chapter, existing: matches.get(index) })),
    removed: existing.filter((chapter) => !used.has(chapter.id)),
  };
}

/** Same matching, but a removed chapter that still has saved reading progress aborts the plan. */
export function planChapterReimport(
  existing: ExistingChapter[],
  incoming: ChapterContent[],
  referencedChapterIds: ReadonlySet<string>,
) {
  const { chapters, removed } = matchChapters(existing, incoming);
  const blocked = removed.filter((chapter) => referencedChapterIds.has(chapter.id));
  if (blocked.length) {
    throw new Error(
      `Reimport stopped: cannot safely match chapters with reading progress: ${blocked.map((chapter) => chapter.slug).join(", ")}. Supply an explicit editorial mapping before replacing them.`,
    );
  }
  return {
    chapters,
    removedIds: removed.map((chapter) => chapter.id),
  };
}

/**
 * Where a saved position lands once a chapter's text changed, with a chapter percentage that agrees with it.
 *
 * `percentage` is stored (reading_progress.percentage) and shown as-is until the reader scrolls: the reader measures
 * it as the share of the article's scroll range already passed, and the book progress derives from it
 * (calculateBookProgress). The page height grows with the text, so the share of the text that precedes the
 * paragraph is the equivalent of that measurement for a paragraph-addressed position. A reader who had finished the
 * chapter and whose last paragraph is still the last one stays at the value they had.
 */
export function remapReadingPosition(
  oldContent: string,
  newContent: string,
  saved: { paragraphIndex: number; percentage: number },
) {
  const paragraphs = (content: string) =>
    content
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  const words = (value: string) => value.split(/\s+/).filter(Boolean).length;
  const oldParagraphs = paragraphs(oldContent);
  const newParagraphs = paragraphs(newContent);
  const paragraphIndex = remapParagraphIndex(oldContent, newContent, saved.paragraphIndex);
  const finishedAndStillLast =
    saved.paragraphIndex >= oldParagraphs.length - 1 && paragraphIndex === newParagraphs.length - 1;
  if (finishedAndStillLast) return { paragraphIndex, percentage: saved.percentage };

  const total = newParagraphs.reduce((sum, paragraph) => sum + words(paragraph), 0);
  const before = newParagraphs.slice(0, paragraphIndex).reduce((sum, paragraph) => sum + words(paragraph), 0);

  return { paragraphIndex, percentage: total > 0 ? Math.min(100, Math.max(0, Math.round((before / total) * 100))) : 0 };
}

export function remapParagraphIndex(oldContent: string, newContent: string, paragraphIndex: number) {
  const paragraphs = (content: string) =>
    content
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  const oldParagraphs = paragraphs(oldContent);
  const newParagraphs = paragraphs(newContent);
  const target = oldParagraphs[paragraphIndex];
  const matches = newParagraphs.flatMap((paragraph, index) => (paragraph === target ? [index] : []));
  if (matches.length === 1) return matches[0];
  // When the paragraph itself was rewritten, retain an approximate relative
  // position in this same identified chapter, bounded by the new text.
  const fraction = Math.min(1, paragraphIndex / Math.max(1, oldParagraphs.length - 1));
  return Math.round(fraction * Math.max(0, newParagraphs.length - 1));
}
