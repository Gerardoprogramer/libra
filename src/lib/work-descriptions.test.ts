import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  countWords,
  getWorkDescription,
  parseWorkDescription,
  summarizeDescription,
  WORK_DESCRIPTION_METADATA_LENGTH,
  WORK_DESCRIPTIONS,
  type WorkDescription,
} from "./work-descriptions";

// A text of exactly `count` words.
const words = (count: number, word = "palabra") => Array.from({ length: count }, () => word).join(" ");

function file(overrides: Record<string, unknown> = {}) {
  return {
    es: { status: "published", text: words(120) },
    en: { status: "draft", text: words(120, "word") },
    sources: ["A reference."],
    review: [],
    ...overrides,
  };
}

function works(entries: Record<string, unknown>): ReadonlyMap<string, WorkDescription> {
  return new Map(Object.entries(entries).map(([slug, value]) => [slug, parseWorkDescription(slug, value)]));
}

test("the published text of the interface language is returned, and a draft language gives nothing", () => {
  const library = works({
    dracula: file({
      es: { status: "published", text: `Texto en español. ${words(100)}` },
      en: { status: "draft", text: `English text. ${words(100, "word")}` },
    }),
  });

  assert.match(getWorkDescription("dracula", "es", library)!, /^Texto en español\./);
  assert.equal(getWorkDescription("dracula", "en", library), null);
});

test("both languages published: each interface language gets its own text", () => {
  const library = works({
    marianela: file({
      es: { status: "published", text: `Uno. ${words(100)}` },
      en: { status: "published", text: `One. ${words(100, "word")}` },
    }),
  });

  assert.match(getWorkDescription("marianela", "es", library)!, /^Uno\./);
  assert.match(getWorkDescription("marianela", "en", library)!, /^One\./);
});

test("a work without a file, or a slug no file can have, has no description", () => {
  const library = works({ dracula: file() });

  for (const slug of ["frankenstein", "libra-test-missing-0f7b16", "../dracula", ""]) {
    assert.equal(getWorkDescription(slug, "es", library), null, slug);
  }
});

test("the text is trimmed, and its word limits are 80 and 180 inclusive", () => {
  assert.equal(
    parseWorkDescription("dracula", file({ es: { status: "draft", text: `  ${words(80)}  ` } })).es.text,
    words(80),
  );
  parseWorkDescription("dracula", file({ es: { status: "draft", text: words(180) } }));

  for (const count of [79, 181, 1]) {
    assert.throws(
      () => parseWorkDescription("dracula", file({ es: { status: "draft", text: words(count) } })),
      new RegExp(`dracula\\.json es: ${count} words, expected 80–180`),
    );
  }
  // Punctuation alone is not a word.
  assert.equal(countWords("Uno , dos — tres ."), 3);
});

test("empty text, an unknown status and invalid shapes are rejected, naming the file and field", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ es: { status: "draft", text: "" } }, /dracula\.json es: empty text/],
    [{ es: { status: "draft", text: "   \t " } }, /dracula\.json es: empty text/],
    [{ es: { status: "draft", text: 120 } }, /dracula\.json es: empty text/],
    [{ en: { status: "review", text: words(120) } }, /dracula\.json en: unknown status "review"/],
    [{ en: { status: "PUBLISHED", text: words(120) } }, /unknown status "PUBLISHED"/],
    [{ en: { text: words(120) } }, /unknown status undefined/],
    [{ en: undefined }, /dracula\.json en: missing/],
    [{ es: { status: "draft", text: `${words(60)}\n\n${words(60)}` } }, /line breaks are not supported/],
    [{ es: { status: "draft", text: words(120), stauts: "x" } }, /dracula\.json es: unknown field stauts/],
    [{ summary: "x" }, /dracula\.json: unknown field summary/],
    [{ sources: "A reference." }, /sources: must be a list of non-empty strings/],
    [{ sources: [""] }, /sources: must be a list of non-empty strings/],
    [{ review: [42] }, /review: must be a list of non-empty strings/],
    [{ sources: [] }, /a published description needs its sources/],
  ];

  for (const [overrides, error] of cases) {
    assert.throws(() => parseWorkDescription("dracula", file(overrides)), error, JSON.stringify(overrides));
  }
  assert.throws(() => parseWorkDescription("Dracula Novel", file()), /invalid book slug/);
  assert.throws(() => parseWorkDescription("dracula", null), /must be an object/);
  // Drafts may still be missing their sources.
  parseWorkDescription(
    "dracula",
    file({ es: { status: "draft", text: words(120) }, en: { status: "draft", text: words(120) }, sources: [] }),
  );
});

test("machine-summary boilerplate is rejected in both languages", () => {
  for (const phrase of [
    "This is an automatically generated summary.",
    "An auto-generated description.",
    "AI-generated text.",
    "Este es un resumen generado automáticamente.",
    "Resumen automático de la obra.",
    "Texto generado por inteligencia artificial.",
    "Descripción generada con IA.",
  ]) {
    assert.throws(
      () => parseWorkDescription("dracula", file({ en: { status: "draft", text: `${phrase} ${words(100, "word")}` } })),
      /contains an automatic-summary phrase/,
      phrase,
    );
  }
});

test("metadata takes the description whole when it fits, or cut at a word with an ellipsis", () => {
  assert.equal(summarizeDescription("  A short   description. "), "A short description.");

  const long = `${words(40, "word")}, and more words after the comma.`;
  const summary = summarizeDescription(long);
  assert.ok(summary.length <= WORK_DESCRIPTION_METADATA_LENGTH, String(summary.length));
  assert.match(summary, /^word( word)*…$/);
  assert.ok(long.startsWith(summary.slice(0, -1)));
  // A single word longer than the limit is cut inside it.
  assert.equal(summarizeDescription("x".repeat(200), 10), `${"x".repeat(9)}…`);
});

// The content of content/works.

const directory = new URL("../../content/works/", import.meta.url);
const pilots = ["dracula", "frankenstein", "marianela", "treasure-island"];

test("every file in content/works is registered under its file name, and valid", () => {
  const slugs = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();

  assert.deepEqual([...WORK_DESCRIPTIONS.keys()].sort(), slugs);
  for (const slug of slugs) {
    assert.deepEqual(
      WORK_DESCRIPTIONS.get(slug),
      parseWorkDescription(slug, JSON.parse(readFileSync(new URL(`${slug}.json`, directory), "utf8"))),
    );
  }
});

test("the four pilot works, once reviewed, are published in both languages", () => {
  for (const slug of pilots) {
    const work = WORK_DESCRIPTIONS.get(slug)!;
    assert.ok(work, slug);

    for (const locale of ["es", "en"] as const) {
      assert.equal(work[locale].status, "published", `${slug} ${locale}`);
      assert.equal(getWorkDescription(slug, locale), work[locale].text, `${slug} ${locale}`);
      // The editorial target, inside the wider validation limits.
      const count = countWords(work[locale].text);
      assert.ok(count >= 100 && count <= 150, `${slug} ${locale}: ${count} words`);
    }
    assert.ok(work.sources.length > 0, slug);
    assert.ok(work.review.length > 0, slug);
  }
});

// The 33 works published on 2026-10-29, audited one by one: each has a reviewed description in both interface
// languages, since its page exists in both. A work added to the catalog later starts without one until it is written.
const catalog = [
  "a-christmas-carol",
  "a-tale-of-two-cities",
  "adventures-of-sherlock-holmes",
  "alice-in-wonderland",
  "anne-of-green-gables",
  "dracula",
  "el-amigo-manso",
  "fortunata-y-jacinta",
  "frankenstein",
  "great-expectations",
  "jane-eyre",
  "jekyll-and-hyde",
  "la-corte-de-carlos-iv",
  "lazarillo-de-tormes",
  "little-women",
  "marianela",
  "miau",
  "moby-dick",
  "niebla",
  "persuasion",
  "pride-and-prejudice",
  "sense-and-sensibility",
  "sotileza",
  "the-adventures-of-tom-sawyer",
  "the-call-of-the-wild",
  "the-picture-of-dorian-gray",
  "the-secret-garden",
  "the-time-machine",
  "the-war-of-the-worlds",
  "the-wonderful-wizard-of-oz",
  "trafalgar",
  "treasure-island",
  "tristana",
];

test("every audited work of the catalog has its description published in both languages, with notes", () => {
  for (const slug of catalog) {
    const work = WORK_DESCRIPTIONS.get(slug);
    assert.ok(work, `${slug}: no description`);

    for (const locale of ["es", "en"] as const) {
      assert.equal(work[locale].status, "published", `${slug} ${locale}`);
      assert.equal(getWorkDescription(slug, locale), work[locale].text, `${slug} ${locale}`);
    }
    // The two languages are two texts, not one copied into the other.
    assert.notEqual(work.es.text, work.en.text, slug);
    assert.ok(work.sources.length > 0, slug);
    assert.ok(work.review.length > 0, slug);
  }
});

test("Lazarillo de Tormes has its description published in both languages, with sources", () => {
  const work = WORK_DESCRIPTIONS.get("lazarillo-de-tormes")!;
  assert.ok(work);

  for (const locale of ["es", "en"] as const) {
    assert.equal(work[locale].status, "published", locale);
    assert.equal(getWorkDescription("lazarillo-de-tormes", locale), work[locale].text);
    const count = countWords(work[locale].text);
    assert.ok(count >= 120 && count <= 150, `${locale}: ${count} words`);
  }
  assert.ok(work.sources.length > 0);
});

// Only the book page reads the descriptions (it hands its synopsis to BookSynopsis as text), never the reader or a query.
test("only the book page imports the work descriptions", () => {
  const root = new URL("../", import.meta.url);
  const importers = (readdirSync(root, { recursive: true }) as string[])
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .filter((name) => readFileSync(new URL(name.split("\\").join("/"), root), "utf8").includes("lib/work-descriptions"))
    .map((name) => name.split("\\").join("/"))
    .sort();

  assert.deepEqual(importers, ["app/[locale]/books/[slug]/(book)/page.tsx"]);
});

test("every published description has its sources and stays within the editorial target", () => {
  for (const [slug, work] of WORK_DESCRIPTIONS) {
    for (const locale of ["es", "en"] as const) {
      if (work[locale].status !== "published") continue;
      const count = countWords(work[locale].text);
      assert.ok(count >= 100 && count <= 150, `${slug} ${locale}: ${count} words`);
      assert.ok(work.sources.length > 0, slug);
    }
  }
});
