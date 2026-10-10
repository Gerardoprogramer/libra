import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { editions } from "./editions";

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, {
        onDelete: "cascade",
      }),

    number: integer("number").notNull(),

    slug: text("slug").notNull(),

    title: text("title").notNull(),

    content: text("content").notNull(),

    wordCount: integer("word_count"),

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
    index("chapters_edition_idx").on(table.editionId),

    uniqueIndex("chapters_edition_slug_idx").on(table.editionId, table.slug),

    uniqueIndex("chapters_edition_number_idx").on(table.editionId, table.number),
  ],
).enableRLS();
