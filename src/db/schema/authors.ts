import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const authors = pgTable("authors", {
  id: uuid("id").defaultRandom().primaryKey(),

  slug: text("slug").notNull().unique(),

  name: text("name").notNull(),

  birthYear: integer("birth_year"),
  deathYear: integer("death_year"),

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
});
