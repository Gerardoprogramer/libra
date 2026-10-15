export interface PublicationFacts {
  title: string;
  language: string;
  chapterCount: number;
  /** Chapters whose text is empty or only whitespace. */
  emptyChapterCount: number;
  wordCount: number;
  authorCount: number;
  notes: string | undefined;
}

export const MIN_REVIEW_NOTES_LENGTH = 10;

/**
 * What must be true before an edition can become public. Technical completeness only: whether a work is in
 * the public domain is a human decision that the operator records in `notes`.
 */
export function findPublicationProblems(facts: PublicationFacts): string[] {
  const problems: string[] = [];

  if (!facts.title.trim()) problems.push("the edition has no title");
  if (!facts.language.trim()) problems.push("the edition has no language");
  if (facts.chapterCount === 0) problems.push("the edition has no chapters");
  if (facts.emptyChapterCount > 0) problems.push(`${facts.emptyChapterCount} chapter(s) have no text`);
  if (facts.chapterCount > 0 && facts.wordCount === 0) problems.push("the edition has no readable text");
  if (facts.authorCount === 0) {
    problems.push("the book has no author, so the catalog would never list the edition");
  }
  if ((facts.notes?.trim().length ?? 0) < MIN_REVIEW_NOTES_LENGTH) {
    problems.push(
      `--notes must record the grounds of the rights decision (at least ${MIN_REVIEW_NOTES_LENGTH} characters), e.g. the author's death year and the jurisdiction relied on`,
    );
  }

  return problems;
}
