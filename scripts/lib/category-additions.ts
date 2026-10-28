/** A category a book already has, as stored in book_categories. */
export interface ExistingAssignment {
  bookSlug: string;
  categorySlug: string;
  position: number;
}

/** A relation to insert. */
export interface CategoryAddition {
  bookSlug: string;
  categorySlug: string;
  position: number;
}

/**
 * The relations to insert so that every listed book has its listed categories. Only additions: a category a book
 * already has keeps its row and position, a category not listed is never removed, and books that are not listed are
 * never touched. New relations go after the book's existing ones, in the listed order. Planning again against the
 * result adds nothing.
 */
export function planCategoryAdditions(
  requested: Readonly<Record<string, readonly string[]>>,
  existing: readonly ExistingAssignment[],
): CategoryAddition[] {
  const additions: CategoryAddition[] = [];

  for (const [bookSlug, categorySlugs] of Object.entries(requested)) {
    const duplicates = categorySlugs.filter((slug, index) => categorySlugs.indexOf(slug) !== index);
    if (duplicates.length > 0) throw new Error(`Duplicate categories for ${bookSlug}: ${duplicates.join(", ")}`);

    const current = existing.filter((assignment) => assignment.bookSlug === bookSlug);
    const assigned = new Set(current.map((assignment) => assignment.categorySlug));
    let position = current.reduce((last, assignment) => Math.max(last, assignment.position), -1) + 1;

    for (const categorySlug of categorySlugs) {
      if (assigned.has(categorySlug)) continue;
      additions.push({ bookSlug, categorySlug, position: position++ });
    }
  }

  return additions;
}
