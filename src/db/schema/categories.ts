import { index, integer, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { books } from "./books";

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),

  slug: text("slug").notNull().unique(),

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

export const categoryTranslations = pgTable(
  "category_translations",
  {
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, {
        onDelete: "cascade",
      }),

    locale: varchar("locale", {
      length: 10,
    }).notNull(),

    name: text("name").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.categoryId, table.locale],
    }),

    index("category_translations_locale_idx").on(table.locale),
  ],
).enableRLS();

export const bookCategories = pgTable(
  "book_categories",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, {
        onDelete: "cascade",
      }),

    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, {
        onDelete: "cascade",
      }),

    position: integer("position").default(0).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.bookId, table.categoryId],
    }),

    index("book_categories_book_idx").on(table.bookId),

    index("book_categories_category_idx").on(table.categoryId),
  ],
).enableRLS();
