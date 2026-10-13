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

/** Match identity, never chapter number: a new prologue shifts every number. */
export function planChapterReimport(
  existing: ExistingChapter[],
  incoming: ChapterContent[],
  referencedChapterIds: ReadonlySet<string>,
) {
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
  const removed = existing.filter((chapter) => !used.has(chapter.id));
  const blocked = removed.filter((chapter) => referencedChapterIds.has(chapter.id));
  if (blocked.length) {
    throw new Error(
      `Reimport stopped: cannot safely match chapters with reading progress: ${blocked.map((chapter) => chapter.slug).join(", ")}. Supply an explicit editorial mapping before replacing them.`,
    );
  }
  return {
    chapters: incoming.map((chapter, index) => ({ ...chapter, existing: matches.get(index) })),
    removedIds: removed.map((chapter) => chapter.id),
  };
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
