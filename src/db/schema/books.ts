import { index, integer, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { authors } from "./authors";

export const books = pgTable("books", {
  id: uuid("id").defaultRandom().primaryKey(),

  slug: text("slug").notNull().unique(),

  originalTitle: text("original_title").notNull(),

  originalLanguage: varchar("original_language", {
    length: 10,
  }).notNull(),

  originalPublicationYear: integer("original_publication_year"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
}).enableRLS();

export const bookAuthors = pgTable(
  "book_authors",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, {
        onDelete: "cascade",
      }),

    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, {
        onDelete: "cascade",
      }),

    position: integer("position").default(0).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.bookId, table.authorId],
    }),

    // The primary key leads with book_id; author pages and author counts look books up by author.
    index("book_authors_author_idx").on(table.authorId),
  ],
).enableRLS();
