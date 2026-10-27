import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { chapterBlocksForStorage, readStoredChapterBlocks, type ChapterBlocks } from "../../lib/chapter-blocks";
import * as schema from ".";
import { chapters, editionAssets, imageAssets } from ".";

// Migration 0010 (chapter blocks and image assets), checked without a database: the Drizzle definitions, the SQL
// drizzle-kit generated from them, and the constraint expressions themselves. Nothing here connects to PostgreSQL;
// how the constraints behave on real rows is checked when the migration is applied to a development database.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const migration = read("drizzle/0010_chapter_blocks_image_assets.sql");
const statements = migration.split("--> statement-breakpoint\n").map((statement) => statement.trim());

const column = (table: PgTable, name: string) => {
  const found = getTableConfig(table).columns.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
};
const checkSql = (table: PgTable, name: string) => {
  const found = getTableConfig(table).checks.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
};

test("chapters.blocks is a nullable jsonb column with no default, so existing chapters stay as they are", () => {
  const blocks = column(chapters, "blocks");
  assert.equal(blocks.getSQLType(), "jsonb");
  assert.equal(blocks.notNull, false);
  assert.equal(blocks.hasDefault, false);
  assert.ok(checkSql(chapters, "chapters_blocks_envelope_check"));
  // The existing columns keep their definitions.
  assert.equal(column(chapters, "content").notNull, true);
  assert.equal(getTableConfig(chapters).enableRLS, true);

  assert.ok(statements.includes('ALTER TABLE "chapters" ADD COLUMN "blocks" jsonb;'));
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

test("chapters.blocks is typed unknown: a row's blocks are ChapterBlocks only after readStoredChapterBlocks", () => {
  // Checked by the type checker: the column promises nothing about what the database returns or accepts.
  const selected: Equal<(typeof chapters.$inferSelect)["blocks"], unknown> = true;
  const inserted: Equal<(typeof chapters.$inferInsert)["blocks"], unknown> = true;
  assert.ok(selected && inserted);

  const content = "One paragraph.";
  const valid = { version: 1, blocks: [{ type: "paragraph", content: [{ text: content }] }] };
  const row = (blocks: unknown) => ({ content, blocks }) as Pick<typeof chapters.$inferSelect, "content" | "blocks">;

  // @ts-expect-error a stored value is not ChapterBlocks until it has been validated
  const unchecked: ChapterBlocks | null = row(valid).blocks;
  assert.ok(unchecked);

  const read = readStoredChapterBlocks(row(valid).blocks, row(valid).content);
  assert.equal(read.status, "blocks");
  assert.deepEqual(read.status === "blocks" && read.blocks, valid);
  // Rows imported before blocks existed, and stored values outside the contract, fall back to `content`.
  assert.deepEqual(readStoredChapterBlocks(row(null).blocks, content), { status: "absent" });
  assert.equal(
    readStoredChapterBlocks(row({ version: 1, blocks: [{ type: "html" }] }).blocks, content).status,
    "invalid",
  );

  // What is written comes from chapterBlocksForStorage, whose result is the validated ChapterBlocks.
  const written: (typeof chapters.$inferInsert)["blocks"] = chapterBlocksForStorage(valid, content);
  assert.deepEqual(written, valid);
  assert.throws(() => chapterBlocksForStorage({ version: 2, blocks: [] }, content), /Invalid chapter blocks/);
});

test("image_assets: one row per source, codec and width, every column required, RLS without policies", () => {
  const config = getTableConfig(imageAssets);
  for (const item of config.columns) assert.equal(item.notNull, true, item.name);
  assert.equal(config.enableRLS, true);
  assert.deepEqual(config.policies, []);

  const identity = config.indexes.find((index) => index.config.name === "image_assets_identity_idx");
  assert.ok(identity?.config.unique);
  assert.deepEqual(
    identity.config.columns.map((item) => ("name" in item ? item.name : "")),
    ["source_sha256", "codec_id", "max_width"],
  );
  // The object key is indexed for lookups but not unique: two sources may normalize to the same bytes.
  const byKey = config.indexes.find((index) => index.config.name === "image_assets_object_key_idx");
  assert.equal(byKey?.config.unique, false);

  assert.deepEqual(config.checks.map((item) => item.name).sort(), [
    "image_assets_byte_size_check",
    "image_assets_codec_id_check",
    "image_assets_dimensions_check",
    "image_assets_media_type_check",
    "image_assets_object_key_check",
    "image_assets_sha256_check",
    "image_assets_source_sha256_check",
  ]);
});

test("edition_assets: one association per edition and source path, cascading with the edition, restricting assets", () => {
  const config = getTableConfig(editionAssets);
  for (const item of config.columns) assert.equal(item.notNull, true, item.name);
  assert.equal(config.enableRLS, true);
  assert.deepEqual(config.policies, []);

  const unique = config.indexes.find((index) => index.config.name === "edition_assets_edition_source_path_idx");
  assert.ok(unique?.config.unique);
  assert.deepEqual(
    unique.config.columns.map((item) => ("name" in item ? item.name : "")),
    ["edition_id", "source_path"],
  );

  const onDelete = (columnName: string) =>
    config.foreignKeys.find((key) => key.reference().columns[0].name === columnName)?.onDelete;
  assert.equal(onDelete("edition_id"), "cascade");
  assert.equal(onDelete("asset_id"), "restrict");
});

test("the migration is additive: new tables with RLS, one nullable column, no drop, rewrite, grant or policy", () => {
  assert.equal(statements.length, 12);
  for (const statement of statements) {
    // Foreign-key actions ("ON DELETE cascade") are part of a definition, not data changes.
    const definition = statement.replace(/ON (DELETE|UPDATE) (cascade|restrict|no action|set null)/gi, "");
    assert.doesNotMatch(
      definition,
      /\bDROP\b|\bALTER COLUMN\b|\bRENAME\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\b/i,
      statement,
    );
    assert.doesNotMatch(statement, /\bGRANT\b|\bCREATE POLICY\b|\bDISABLE ROW LEVEL SECURITY\b/i, statement);
  }
  for (const table of ["image_assets", "edition_assets"]) {
    assert.ok(statements.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`), table);
  }
  // The only statements on an existing table: the new column and its check.
  const onExisting = statements.filter((statement) => /^ALTER TABLE "(?!image_assets|edition_assets)/.test(statement));
  assert.equal(onExisting.length, 2);
  assert.equal(onExisting[0], 'ALTER TABLE "chapters" ADD COLUMN "blocks" jsonb;');
  assert.ok(onExisting[1].startsWith('ALTER TABLE "chapters" ADD CONSTRAINT "chapters_blocks_envelope_check" CHECK'));
});

test("the journal and snapshot continue from 0009, and the schema has nothing left to migrate", async () => {
  const journal = JSON.parse(read("drizzle/meta/_journal.json"));
  const last = journal.entries.at(-1);
  assert.equal(last.idx, 10);
  assert.equal(last.tag, "0010_chapter_blocks_image_assets");

  const previous = JSON.parse(read("drizzle/meta/0009_snapshot.json"));
  const snapshot = JSON.parse(read("drizzle/meta/0010_snapshot.json"));
  assert.equal(snapshot.prevId, previous.id);

  // drizzle-kit's own comparison: the schema in the code and the snapshot of the last migration are the same.
  const require = createRequire(import.meta.url);
  const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");
  const current = generateDrizzleJson(schema, snapshot.id);
  assert.deepEqual(await generateMigration(snapshot, current), []);
});

// The CHECK expressions are POSIX regular expressions whose syntax here is the same in JavaScript; they are read from
// the generated SQL and evaluated on samples, so the constraint text itself is what is tested.

function sqlPattern(constraint: string, operator: "~" | "!~" | "!~*", nth = 0) {
  // A constraint inside CREATE TABLE ends its line with "),", one added with ALTER TABLE with ");".
  const sql = migration.match(new RegExp(`CONSTRAINT "${constraint}" CHECK \\((.*)\\)[,;]?$`, "m"))?.[1];
  assert.ok(sql, constraint);
  const escaped = operator.replace(/[*]/g, "\\*");
  const patterns = [...sql.matchAll(new RegExp(`"\\s${escaped} '([^']*)'`, "g"))].map((match) => match[1]);
  assert.ok(patterns[nth] !== undefined, `${constraint} ${operator}`);
  return new RegExp(patterns[nth], operator === "!~*" ? "i" : "");
}

test("source path constraint: the same rules as figure paths in chapter blocks", () => {
  const scheme = sqlPattern("edition_assets_source_path_check", "!~*");
  const segments = sqlPattern("edition_assets_source_path_check", "!~");
  const allowed = (path: string) =>
    path.length >= 1 && path.length <= 1024 && !scheme.test(path) && !path.includes("\\") && !segments.test(path);

  for (const path of [
    "OEBPS/images/plate-1.png",
    "image.jpg",
    "a/.hidden/b.png",
    "OEBPS/5027814354573229812_illus-003_sml.jpg",
  ]) {
    assert.ok(allowed(path), path);
  }
  for (const path of [
    "",
    "/etc/passwd",
    "../secret.png",
    "OEBPS/../x.png",
    "OEBPS/./x.png",
    "OEBPS//x.png",
    "OEBPS/",
    "https://example.com/x.png",
    "data:image/png;base64,AAAA",
    "C:/x.png",
    "OEBPS\\x.png",
    "x".repeat(1025),
  ]) {
    assert.ok(!allowed(path), path);
  }
});

test("digest constraints accept only lowercase 64-digit hex", () => {
  const digest = sqlPattern("image_assets_sha256_check", "~");
  assert.ok(digest.test("a".repeat(64)));
  for (const value of ["A".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}g`, ""]) {
    assert.ok(!digest.test(value), value);
  }
  assert.equal(sqlPattern("image_assets_source_sha256_check", "~").source, digest.source);
});

test("the object key constraint ties the key to the stored bytes' digest and format", () => {
  const sql = migration.match(/CONSTRAINT "image_assets_object_key_check" CHECK \((.*)\),?$/m)?.[1] ?? "";
  // key = 'illustrations/' || sha256 || '.' || extension of media_type
  assert.match(sql, /"object_key" = 'illustrations\/' \|\| "image_assets"\."sha256" \|\| '\.' \|\| CASE/);
  for (const [mediaType, extension] of [
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ]) {
    assert.ok(sql.includes(`WHEN '${mediaType}' THEN '${extension}'`), mediaType);
  }
  // An unknown media type makes the CASE NULL, which a CHECK would let through: the media type check refuses it.
  assert.ok(checkSql(imageAssets, "image_assets_media_type_check"));
  assert.match(migration, /"media_type" IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/);
});
