import type { ExistingAssignment } from "./category-additions";

/** A category of db:seed:categories, with its names in both locales. */
export interface CategoryDefinition {
  slug: string;
  en: string;
  es: string;
}

/** A stored category name, as read from category_translations. */
export interface StoredCategoryName {
  slug: string;
  locale: string;
  name: string;
}

export interface SeedCategoriesArguments {
  /** Without --apply the command is a dry run: it reads the database and prints the plan, and writes nothing. */
  apply: boolean;
}

/**
 * Arguments of db:seed:categories. Only --apply and --confirm-database <id> are accepted, each at most once; the id
 * itself is checked against the target by assertWriteAllowed. As in db:replace-cover, --confirm-database confirms a
 * write, so it is refused without --apply.
 */
export function parseSeedCategoriesArguments(rawArgs: readonly string[]): SeedCategoriesArguments {
  // pnpm forwards the separator in `pnpm db:seed:categories -- --apply`.
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  let apply = false;
  let confirmDatabase: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === "--apply") {
      if (apply) throw new Error("Expected --apply at most once.");
      apply = true;
      continue;
    }

    if (argument === "--confirm-database") {
      const value = args[++index];
      if (confirmDatabase !== undefined || !value || value.startsWith("--")) {
        throw new Error("Expected one --confirm-database value.");
      }
      confirmDatabase = value;
      continue;
    }

    throw new Error(`Unknown db:seed:categories argument: ${argument}`);
  }

  if (confirmDatabase !== undefined && !apply) throw new Error("--confirm-database is only used with --apply.");

  return { apply };
}

/**
 * What --apply would change, one line each: categories created or renamed, and for every listed book its stored
 * categories (in position order) against the listed ones. The seed replaces the relations of every listed book, so a
 * book whose list differs in content or order is replaced; books that are not listed are never touched.
 */
export function planCategorySeed(
  definitions: readonly CategoryDefinition[],
  assignments: Readonly<Record<string, readonly string[]>>,
  storedNames: readonly StoredCategoryName[],
  storedCategorySlugs: readonly string[],
  current: readonly ExistingAssignment[],
): string[] {
  const lines: string[] = [];
  const stored = new Set(storedCategorySlugs);

  for (const definition of definitions) {
    if (!stored.has(definition.slug)) {
      lines.push(`would create category ${definition.slug} (en "${definition.en}", es "${definition.es}")`);
      continue;
    }

    for (const locale of ["en", "es"] as const) {
      const name = storedNames.find((row) => row.slug === definition.slug && row.locale === locale)?.name;
      if (name !== definition[locale]) {
        lines.push(`would set the ${locale} name of ${definition.slug} to "${definition[locale]}"`);
      }
    }
  }

  for (const [bookSlug, categorySlugs] of Object.entries(assignments)) {
    const before = current
      .filter((row) => row.bookSlug === bookSlug)
      .sort((a, b) => a.position - b.position)
      .map((row) => row.categorySlug);
    const after = [...categorySlugs];

    lines.push(
      before.join(",") === after.join(",")
        ? `${bookSlug}: unchanged (${after.join(", ")})`
        : `${bookSlug}: would replace [${before.join(", ")}] with [${after.join(", ")}]`,
    );
  }

  return lines;
}
