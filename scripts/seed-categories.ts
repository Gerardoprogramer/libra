import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { bookCategories, books, categories, categoryTranslations } from "../src/db/schema";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

const client = postgres(process.env.DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: "require",
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
];

const assignments: Record<string, string[]> = {
  frankenstein: ["classic-literature", "gothic-fiction", "horror", "science-fiction"],

  dracula: ["classic-literature", "gothic-fiction", "horror"],
};

async function main() {
  console.log("Seeding categories...");

  for (const definition of categoryDefinitions) {
    const [category] = await db
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

    await db
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

    await db
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

  for (const [bookSlug, categorySlugs] of Object.entries(assignments)) {
    const [book] = await db
      .select({
        id: books.id,
      })
      .from(books)
      .where(eq(books.slug, bookSlug))
      .limit(1);

    if (!book) {
      throw new Error(`Book not found: ${bookSlug}`);
    }

    const categoryRows = await db
      .select({
        id: categories.id,
        slug: categories.slug,
      })
      .from(categories)
      .where(inArray(categories.slug, categorySlugs));

    const categoryMap = new Map(categoryRows.map((category) => [category.slug, category.id]));

    await db.delete(bookCategories).where(eq(bookCategories.bookId, book.id));

    for (let position = 0; position < categorySlugs.length; position++) {
      const categorySlug = categorySlugs[position];

      const categoryId = categoryMap.get(categorySlug);

      if (!categoryId) {
        throw new Error(`Category not found: ${categorySlug}`);
      }

      await db.insert(bookCategories).values({
        bookId: book.id,
        categoryId,
        position,
      });
    }

    console.log(`${bookSlug}: ${categorySlugs.join(", ")}`);
  }

  console.log("");
  console.log("Categories seeded successfully");
}

main()
  .catch((error) => {
    console.error("");
    console.error("Category seed failed");

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
