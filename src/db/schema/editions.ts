import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { books } from "./books";

export const copyrightStatusEnum = pgEnum("copyright_status", [
  "PUBLIC_DOMAIN_VERIFIED",
  "LICENSED",
  "ORIGINAL",
  "PENDING_REVIEW",
  "REJECTED",
]);

export const publicationStatusEnum = pgEnum("publication_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);

export const editions = pgTable(
  "editions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, {
        onDelete: "cascade",
      }),

    slug: text("slug").notNull(),

    language: varchar("language", {
      length: 10,
    }).notNull(),

    title: text("title").notNull(),

    description: text("description"),

    translator: text("translator"),

    publicationYear: integer("publication_year"),

    coverUrl: text("cover_url"),

    sourceName: text("source_name"),

    sourceIdentifier: text("source_identifier"),

    sourceUrl: text("source_url"),

    copyrightStatus: copyrightStatusEnum("copyright_status").default("PENDING_REVIEW").notNull(),

    publicationStatus: publicationStatusEnum("publication_status").default("DRAFT").notNull(),

    copyrightNotes: text("copyright_notes"),

    verifiedAt: timestamp("verified_at", {
      withTimezone: true,
    }),

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
  },
  (table) => [
    uniqueIndex("editions_book_slug_idx").on(table.bookId, table.slug),

    index("editions_book_language_idx").on(table.bookId, table.language),

    index("editions_publication_status_idx").on(table.publicationStatus),

    index("editions_copyright_status_idx").on(table.copyrightStatus),

    uniqueIndex("editions_source_idx").on(table.sourceName, table.sourceIdentifier),
  ],
);
