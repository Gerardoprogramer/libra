import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { bookCategories, books, categories } from "../src/db/schema";

import { planCategoryAdditions } from "./lib/category-additions";
import { formatImportError } from "./lib/import-errors";
import { revalidateEditorialCache } from "./lib/revalidate-cache";
import { assertWriteAllowed, sslFor } from "./lib/write-guard";

// Adds categories to the listed books only. Unlike db:seed:categories, which replaces the relations of every book
// it lists, this never deletes a relation or touches another book: it inserts the missing rows, so running it again
// changes nothing. The categories must already exist (db:seed:categories defines them); none is created here.
//
//   pnpm db:categories:add                                     dry run: prints the plan (READ ONLY transaction)
//   pnpm db:categories:add -- --apply --confirm-database <id>  inserts the missing relations

const additions: Record<string, string[]> = {
  "lazarillo-de-tormes": ["classic-literature"],

  "jane-eyre": ["classic-literature", "romance"],

  "great-expectations": ["classic-literature"],

  "the-adventures-of-tom-sawyer": ["classic-literature", "adventure"],

  niebla: ["classic-literature"],

  trafalgar: ["classic-literature"],
};

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");

// Fails before any connection is opened if the target is remote and not explicitly confirmed.
if (apply) {
  assertWriteAllowed({
    connectionString: process.env.DIRECT_DATABASE_URL,
    args,
    script: "db:categories:add",
    allowRemote: true,
  });
}

const client = postgres(process.env.DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: sslFor(process.env.DIRECT_DATABASE_URL),
});

const db = drizzle(client);

async function main() {
  const bookSlugs = Object.keys(additions);
  const categorySlugs = [...new Set(Object.values(additions).flat())];

  const inserted = await db.transaction(
    async (tx) => {
      const bookQuery = tx.select({ id: books.id, slug: books.slug }).from(books).where(inArray(books.slug, bookSlugs));
      // Serializes concurrent writes: the plan is read and applied with the listed books locked. A dry run, in a READ
      // ONLY transaction, cannot lock and does not need to.
      const bookRows = apply ? await bookQuery.for("update") : await bookQuery;
      const bookIds = new Map(bookRows.map((book) => [book.slug, book.id]));
      const missingBooks = bookSlugs.filter((slug) => !bookIds.has(slug));
      if (missingBooks.length > 0) throw new Error(`Books not found: ${missingBooks.join(", ")}`);

      const categoryRows = await tx
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
        .where(inArray(categories.slug, categorySlugs));
      const categoryIds = new Map(categoryRows.map((category) => [category.slug, category.id]));
      const missingCategories = categorySlugs.filter((slug) => !categoryIds.has(slug));
      if (missingCategories.length > 0) throw new Error(`Categories not found: ${missingCategories.join(", ")}`);

      // Every relation the listed books already have, whatever its category.
      const existing = await tx
        .select({ bookSlug: books.slug, categorySlug: categories.slug, position: bookCategories.position })
        .from(bookCategories)
        .innerJoin(books, eq(books.id, bookCategories.bookId))
        .innerJoin(categories, eq(categories.id, bookCategories.categoryId))
        .where(inArray(bookCategories.bookId, [...bookIds.values()]));

      const plan = planCategoryAdditions(additions, existing);

      for (const addition of plan) {
        console.log(
          `${apply ? "add" : "would add"} ${addition.bookSlug}: ${addition.categorySlug} (position ${addition.position})`,
        );
      }
      if (plan.length === 0) console.log("Every listed book already has its categories. Nothing to add.");
      if (!apply || plan.length === 0) return 0;

      const rows = await tx
        .insert(bookCategories)
        .values(
          plan.map((addition) => ({
            bookId: bookIds.get(addition.bookSlug)!,
            categoryId: categoryIds.get(addition.categorySlug)!,
            position: addition.position,
          })),
        )
        .onConflictDoNothing()
        .returning({ bookId: bookCategories.bookId });

      return rows.length;
    },
    apply ? undefined : { accessMode: "read only" },
  );

  if (!apply) {
    console.log("Dry run only. Nothing was written. Use --apply --confirm-database <id> to insert.");
    return;
  }

  console.log(`Inserted ${inserted} relation(s).`);
  if (inserted > 0) await revalidateEditorialCache(["library", ...bookSlugs.map((slug) => `book:${slug}`)]);
}

main()
  .catch((error) => {
    console.error("");
    console.error("Adding book categories failed");
    console.error(formatImportError(error));

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
