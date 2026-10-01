import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { authors, bookAuthors, books, chapters, editions } from "../src/db/schema";
import { formatImportError } from "./lib/import-errors";

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

async function seed() {
  console.log("Seeding database...");

  // Author
  const [author] = await db
    .insert(authors)
    .values({
      slug: "mary-shelley",
      name: "Mary Shelley",
      birthYear: 1797,
      deathYear: 1851,
    })
    .onConflictDoUpdate({
      target: authors.slug,
      set: {
        name: "Mary Shelley",
        birthYear: 1797,
        deathYear: 1851,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Book
  const [book] = await db
    .insert(books)
    .values({
      slug: "frankenstein",
      originalTitle: "Frankenstein",
      originalLanguage: "en",
      originalPublicationYear: 1818,
    })
    .onConflictDoUpdate({
      target: books.slug,
      set: {
        originalTitle: "Frankenstein",
        originalLanguage: "en",
        originalPublicationYear: 1818,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Book ↔ Author
  await db
    .insert(bookAuthors)
    .values({
      bookId: book.id,
      authorId: author.id,
      position: 0,
    })
    .onConflictDoNothing();

  // English edition
  const [edition] = await db
    .insert(editions)
    .values({
      bookId: book.id,
      slug: "english",
      language: "en",
      title: "Frankenstein",
      description:
        "A young scientist becomes obsessed with creating life, only to confront the consequences of what he has brought into the world.",
      publicationYear: 1818,
      sourceName: "Development seed",
      sourceIdentifier: "frankenstein-en-dev",
      copyrightStatus: "PENDING_REVIEW",
      publicationStatus: "DRAFT",
    })
    .onConflictDoUpdate({
      target: [editions.bookId, editions.slug],
      set: {
        title: "Frankenstein",
        description:
          "A young scientist becomes obsessed with creating life, only to confront the consequences of what he has brought into the world.",
        updatedAt: new Date(),
      },
    })
    .returning();

  const chapterData = [
    {
      number: 1,
      slug: "chapter-1",
      title: "Chapter I",
      content: [
        "This is temporary development content for the first chapter of Frankenstein.",
        "Its purpose is to test Libra's database-driven reader before importing the verified public-domain edition.",
        "Once the importer is ready, this content will be replaced automatically with text from a verified source.",
        "For now, it lets us validate chapters, navigation, reading progress, themes and typography.",
      ].join("\n\n"),
    },
    {
      number: 2,
      slug: "chapter-2",
      title: "Chapter II",
      content: [
        "This is the second temporary chapter stored directly in PostgreSQL.",
        "Libra is no longer dependent on the local books.ts mock for this content.",
        "The next stage will connect these records to the public book pages and reader.",
        "After that, the importer will become responsible for creating editions and chapters.",
      ].join("\n\n"),
    },
  ];

  for (const chapter of chapterData) {
    await db
      .insert(chapters)
      .values({
        editionId: edition.id,
        number: chapter.number,
        slug: chapter.slug,
        title: chapter.title,
        content: chapter.content,
        wordCount: chapter.content.split(/\s+/).length,
      })
      .onConflictDoUpdate({
        target: [chapters.editionId, chapters.slug],
        set: {
          number: chapter.number,
          title: chapter.title,
          content: chapter.content,
          wordCount: chapter.content.split(/\s+/).length,
          updatedAt: new Date(),
        },
      });
  }

  console.log("Seed completed successfully");
  console.log(`Author: ${author.name}`);
  console.log(`Book: ${book.originalTitle}`);
  console.log(`Edition: ${edition.title}`);
}

seed()
  .catch((error) => {
    console.error("Seed failed");
    console.error(formatImportError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
