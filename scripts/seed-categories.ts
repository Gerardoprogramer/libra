import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { bookCategories, books, categories, categoryTranslations } from "../src/db/schema";

import { formatImportError } from "./lib/import-errors";
import { assertWriteAllowed, sslFor } from "./lib/write-guard";
import { revalidateEditorialCache } from "./lib/revalidate-cache";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

// Fails before any connection is opened if the target is remote and not explicitly confirmed.
assertWriteAllowed({
  connectionString: process.env.DIRECT_DATABASE_URL,
  args: process.argv.slice(2),
  script: "db:seed:categories",
  allowRemote: true,
});

const client = postgres(process.env.DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: sslFor(process.env.DIRECT_DATABASE_URL),
});

const db = drizzle(client);

const categoryDefinitions = [
  {
    slug: "classic-literature",
    en: "Classic Literature",
    es: "Literatura clásica",
  },
  {
    slug: "gothic-fiction",
    en: "Gothic Fiction",
    es: "Ficción gótica",
  },
  {
    slug: "horror",
    en: "Horror",
    es: "Terror",
  },
  {
    slug: "science-fiction",
    en: "Science Fiction",
    es: "Ciencia ficción",
  },
  {
    slug: "fantasy",
    en: "Fantasy",
    es: "Fantasía",
  },
  {
    slug: "adventure",
    en: "Adventure",
    es: "Aventura",
  },
  {
    slug: "romance",
    en: "Romance",
    es: "Romance",
  },
  {
    slug: "mystery",
    en: "Mystery",
    es: "Misterio",
  },
];

const assignments: Record<string, string[]> = {
  frankenstein: ["classic-literature", "gothic-fiction", "horror", "science-fiction"],

  dracula: ["classic-literature", "gothic-fiction", "horror"],

  "pride-and-prejudice": ["classic-literature", "romance"],

  "the-picture-of-dorian-gray": ["classic-literature", "gothic-fiction", "horror"],

  "jekyll-and-hyde": ["classic-literature", "gothic-fiction", "horror"],

  "alice-in-wonderland": ["classic-literature", "fantasy", "adventure"],

  "adventures-of-sherlock-holmes": ["classic-literature", "mystery", "adventure"],

  "the-time-machine": ["classic-literature", "science-fiction", "adventure"],

  "the-war-of-the-worlds": ["classic-literature", "science-fiction", "horror"],

  "moby-dick": ["classic-literature", "adventure"],

  "a-christmas-carol": ["classic-literature", "fantasy"],

  "the-wonderful-wizard-of-oz": ["classic-literature", "fantasy", "adventure"],
};

function validateAssignments() {
  const definedCategories = new Set(categoryDefinitions.map((category) => category.slug));

  for (const [bookSlug, categorySlugs] of Object.entries(assignments)) {
    const duplicates = categorySlugs.filter((slug, index) => categorySlugs.indexOf(slug) !== index);

    if (duplicates.length > 0) {
      throw new Error(`Duplicate categories for ${bookSlug}: ${duplicates.join(", ")}`);
    }

    const missing = categorySlugs.filter((slug) => !definedCategories.has(slug));

    if (missing.length > 0) {
      throw new Error(`Unknown categories for ${bookSlug}: ${missing.join(", ")}`);
    }
  }
}

async function main() {
  validateAssignments();

  console.log("Seeding categories...");

  await db.transaction(async (tx) => {
    // Categories + translations
    for (const definition of categoryDefinitions) {
      const [category] = await tx
        .insert(categories)
        .values({
          slug: definition.slug,
        })
        .onConflictDoUpdate({
          target: categories.slug,
          set: {
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!category) {
        throw new Error(`Could not create category: ${definition.slug}`);
      }

      await tx
        .insert(categoryTranslations)
        .values({
          categoryId: category.id,
          locale: "en",
          name: definition.en,
        })
        .onConflictDoUpdate({
          target: [categoryTranslations.categoryId, categoryTranslations.locale],
          set: {
            name: definition.en,
          },
        });

      await tx
        .insert(categoryTranslations)
        .values({
          categoryId: category.id,
          locale: "es",
          name: definition.es,
        })
        .onConflictDoUpdate({
          target: [categoryTranslations.categoryId, categoryTranslations.locale],
          set: {
            name: definition.es,
          },
        });
    }

    // Resolve all categories before touching book assignments.
    const categoryRows = await tx
      .select({
        id: categories.id,
        slug: categories.slug,
      })
      .from(categories)
      .where(
        inArray(
          categories.slug,
          categoryDefinitions.map((category) => category.slug),
        ),
      );

    const categoryMap = new Map(categoryRows.map((category) => [category.slug, category.id]));

    for (const definition of categoryDefinitions) {
      if (!categoryMap.has(definition.slug)) {
        throw new Error(`Category not found after seed: ${definition.slug}`);
      }
    }

    // Resolve every assigned book before deleting any existing relationships.
    const bookSlugs = Object.keys(assignments);

    const bookRows = await tx
      .select({
        id: books.id,
        slug: books.slug,
      })
      .from(books)
      .where(inArray(books.slug, bookSlugs));

    const bookMap = new Map(bookRows.map((book) => [book.slug, book.id]));

    const missingBooks = bookSlugs.filter((slug) => !bookMap.has(slug));

    if (missingBooks.length > 0) {
      throw new Error(`Books not found: ${missingBooks.join(", ")}`);
    }

    // Replace assignments only after every book and category has been validated.
    for (const [bookSlug, categorySlugs] of Object.entries(assignments)) {
      const bookId = bookMap.get(bookSlug);

      if (!bookId) {
        throw new Error(`Book not found: ${bookSlug}`);
      }

      const categoryIds = categorySlugs.map((categorySlug) => {
        const categoryId = categoryMap.get(categorySlug);

        if (!categoryId) {
          throw new Error(`Category not found: ${categorySlug}`);
        }

        return categoryId;
      });

      await tx.delete(bookCategories).where(eq(bookCategories.bookId, bookId));

      await tx.insert(bookCategories).values(
        categoryIds.map((categoryId, position) => ({
          bookId,
          categoryId,
          position,
        })),
      );

      console.log(`${bookSlug}: ${categorySlugs.join(", ")}`);
    }
  });

  console.log("");
  console.log("Categories seeded successfully.");

  const cacheTags = ["library", ...Object.keys(assignments).map((slug) => `book:${slug}`)];

  await revalidateEditorialCache(cacheTags);
}

main()
  .catch((error) => {
    console.error("");
    console.error("Category seed failed");
    console.error(formatImportError(error));

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
