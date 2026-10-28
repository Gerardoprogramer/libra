import { isSlug } from "./catalog-filters";

import dracula from "../../content/works/dracula.json";
import frankenstein from "../../content/works/frankenstein.json";
import lazarilloDeTormes from "../../content/works/lazarillo-de-tormes.json";
import marianela from "../../content/works/marianela.json";
import treasureIsland from "../../content/works/treasure-island.json";

// An editorial description of the work itself, independent of any edition or translation, kept in
// content/works/<book slug>.json with one text per interface language. It is metadata only (description, Open Graph,
// Twitter and structured data): never text on the book page or in the reader. Each language has its own status; only
// a published one is ever used, so a draft stays out of the metadata. The
// files are imported here rather than read at runtime, so they ship with the build, and every one is validated when
// this module loads: an invalid file fails the build and the tests instead of reaching a page.

export const WORK_DESCRIPTION_LOCALES = ["es", "en"] as const;
export const WORK_DESCRIPTION_STATUSES = ["draft", "published"] as const;
// The target is 100–150 words; the limits leave room for editing without accepting a stub or an essay.
export const WORK_DESCRIPTION_WORD_LIMITS = { min: 80, max: 180 } as const;
// The longest description that metadata takes from a work description (search snippets cut longer ones).
export const WORK_DESCRIPTION_METADATA_LENGTH = 160;

export type WorkDescriptionLocale = (typeof WORK_DESCRIPTION_LOCALES)[number];
export type WorkDescriptionStatus = (typeof WORK_DESCRIPTION_STATUSES)[number];

export interface WorkDescriptionText {
  status: WorkDescriptionStatus;
  text: string;
}

export type WorkDescription = Record<WorkDescriptionLocale, WorkDescriptionText> & {
  /** Where each fact comes from. Required once any language is published. */
  sources: string[];
  /** What an editor still has to check. Never shown. */
  review: string[];
};

// Boilerplate of machine-written summaries, which Libra's own descriptions never carry.
const AUTOMATIC_PHRASES = [
  /automatically[\s-]+generated/i,
  /auto[\s-]?generated/i,
  /\bAI[\s-]+generated/i,
  /generad[oa]s?\s+automáticamente/i,
  /resumen\s+automático/i,
  /generad[oa]s?\s+(?:por|con)\s+(?:la\s+)?(?:IA|inteligencia\s+artificial)/i,
];

const FILE_KEYS = [...WORK_DESCRIPTION_LOCALES, "sources", "review"];
const TEXT_KEYS = ["status", "text"];

export function countWords(text: string) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[], context: string) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new Error(`${context}: unknown field ${unknown.join(", ")}`);
}

function parseNotes(value: unknown, context: string) {
  if (!Array.isArray(value) || !value.every((note) => typeof note === "string" && note.trim())) {
    throw new Error(`${context}: must be a list of non-empty strings`);
  }
  return value.map((note: string) => note.trim());
}

function parseText(value: unknown, context: string): WorkDescriptionText {
  if (!isRecord(value)) throw new Error(`${context}: missing`);
  assertKeys(value, TEXT_KEYS, context);

  const { status, text } = value;
  if (!WORK_DESCRIPTION_STATUSES.some((known) => known === status)) {
    throw new Error(`${context}: unknown status ${JSON.stringify(status)}`);
  }
  if (typeof text !== "string" || !text.trim()) throw new Error(`${context}: empty text`);
  // One paragraph, as the page renders it.
  if (/[\r\n]/.test(text)) throw new Error(`${context}: line breaks are not supported`);

  const words = countWords(text);
  if (words < WORK_DESCRIPTION_WORD_LIMITS.min || words > WORK_DESCRIPTION_WORD_LIMITS.max) {
    throw new Error(
      `${context}: ${words} words, expected ${WORK_DESCRIPTION_WORD_LIMITS.min}–${WORK_DESCRIPTION_WORD_LIMITS.max}`,
    );
  }
  const automatic = AUTOMATIC_PHRASES.find((phrase) => phrase.test(text));
  if (automatic) throw new Error(`${context}: contains an automatic-summary phrase (${automatic.source})`);

  return { status: status as WorkDescriptionStatus, text: text.trim() };
}

/** Validates the contents of content/works/<slug>.json. Throws, naming the file and field, on anything invalid. */
export function parseWorkDescription(slug: string, value: unknown): WorkDescription {
  const context = `content/works/${slug}.json`;
  if (!isSlug(slug)) throw new Error(`${context}: invalid book slug`);
  if (!isRecord(value)) throw new Error(`${context}: must be an object`);
  assertKeys(value, FILE_KEYS, context);

  const [es, en] = WORK_DESCRIPTION_LOCALES.map((locale) => parseText(value[locale], `${context} ${locale}`));
  const sources = parseNotes(value.sources, `${context} sources`);
  const review = parseNotes(value.review ?? [], `${context} review`);

  if (sources.length === 0 && [es, en].some((entry) => entry.status === "published")) {
    throw new Error(`${context}: a published description needs its sources`);
  }

  return { es, en, sources, review };
}

/** Every work with a description, keyed by its book slug (the file name). */
export const WORK_DESCRIPTIONS: ReadonlyMap<string, WorkDescription> = new Map(
  Object.entries({
    dracula,
    frankenstein,
    "lazarillo-de-tormes": lazarilloDeTormes,
    marianela,
    "treasure-island": treasureIsland,
  }).map(([slug, value]) => [slug, parseWorkDescription(slug, value)]),
);

/** The published description of a work in an interface language, or null if there is none (a draft included). */
export function getWorkDescription(
  slug: string,
  locale: WorkDescriptionLocale,
  works: ReadonlyMap<string, WorkDescription> = WORK_DESCRIPTIONS,
): string | null {
  const entry = works.get(slug)?.[locale];
  return entry?.status === "published" ? entry.text : null;
}

/** A description cut at a word boundary to fit metadata, marked with an ellipsis when shortened. */
export function summarizeDescription(text: string, maxLength = WORK_DESCRIPTION_METADATA_LENGTH) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;

  // The last space before the limit leaves room for the ellipsis.
  const cut = normalized.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, maxLength - 1)).replace(/[\s,;:.–—-]+$/u, "")}…`;
}
