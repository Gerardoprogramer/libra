import { isSlug } from "./catalog-filters";

import aChristmasCarol from "../../content/works/a-christmas-carol.json";
import aTaleOfTwoCities from "../../content/works/a-tale-of-two-cities.json";
import adventuresOfSherlockHolmes from "../../content/works/adventures-of-sherlock-holmes.json";
import aliceInWonderland from "../../content/works/alice-in-wonderland.json";
import anneOfGreenGables from "../../content/works/anne-of-green-gables.json";
import dracula from "../../content/works/dracula.json";
import elAmigoManso from "../../content/works/el-amigo-manso.json";
import fortunataYJacinta from "../../content/works/fortunata-y-jacinta.json";
import frankenstein from "../../content/works/frankenstein.json";
import greatExpectations from "../../content/works/great-expectations.json";
import janeEyre from "../../content/works/jane-eyre.json";
import jekyllAndHyde from "../../content/works/jekyll-and-hyde.json";
import laCorteDeCarlosIv from "../../content/works/la-corte-de-carlos-iv.json";
import lazarilloDeTormes from "../../content/works/lazarillo-de-tormes.json";
import littleWomen from "../../content/works/little-women.json";
import marianela from "../../content/works/marianela.json";
import miau from "../../content/works/miau.json";
import mobyDick from "../../content/works/moby-dick.json";
import niebla from "../../content/works/niebla.json";
import persuasion from "../../content/works/persuasion.json";
import prideAndPrejudice from "../../content/works/pride-and-prejudice.json";
import senseAndSensibility from "../../content/works/sense-and-sensibility.json";
import sotileza from "../../content/works/sotileza.json";
import theAdventuresOfTomSawyer from "../../content/works/the-adventures-of-tom-sawyer.json";
import theCallOfTheWild from "../../content/works/the-call-of-the-wild.json";
import thePictureOfDorianGray from "../../content/works/the-picture-of-dorian-gray.json";
import theSecretGarden from "../../content/works/the-secret-garden.json";
import theTimeMachine from "../../content/works/the-time-machine.json";
import theWarOfTheWorlds from "../../content/works/the-war-of-the-worlds.json";
import theWonderfulWizardOfOz from "../../content/works/the-wonderful-wizard-of-oz.json";
import trafalgar from "../../content/works/trafalgar.json";
import treasureIsland from "../../content/works/treasure-island.json";
import tristana from "../../content/works/tristana.json";

// An editorial description of the work itself, independent of any edition or translation, kept in
// content/works/<book slug>.json with one text per interface language. The book page shows it as its synopsis and uses
// it in its metadata (description, Open Graph, Twitter and structured data); it is never part of the book, so the
// reader and the chapters never show it. Each language has its own status; only a published one is ever used, so a
// draft stays off the page and out of the metadata. The
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
    "a-christmas-carol": aChristmasCarol,
    "a-tale-of-two-cities": aTaleOfTwoCities,
    "adventures-of-sherlock-holmes": adventuresOfSherlockHolmes,
    "alice-in-wonderland": aliceInWonderland,
    "anne-of-green-gables": anneOfGreenGables,
    dracula,
    "el-amigo-manso": elAmigoManso,
    "fortunata-y-jacinta": fortunataYJacinta,
    frankenstein,
    "great-expectations": greatExpectations,
    "jane-eyre": janeEyre,
    "jekyll-and-hyde": jekyllAndHyde,
    "la-corte-de-carlos-iv": laCorteDeCarlosIv,
    "lazarillo-de-tormes": lazarilloDeTormes,
    "little-women": littleWomen,
    marianela,
    miau,
    "moby-dick": mobyDick,
    niebla,
    persuasion,
    "pride-and-prejudice": prideAndPrejudice,
    "sense-and-sensibility": senseAndSensibility,
    sotileza,
    "the-adventures-of-tom-sawyer": theAdventuresOfTomSawyer,
    "the-call-of-the-wild": theCallOfTheWild,
    "the-picture-of-dorian-gray": thePictureOfDorianGray,
    "the-secret-garden": theSecretGarden,
    "the-time-machine": theTimeMachine,
    "the-war-of-the-worlds": theWarOfTheWorlds,
    "the-wonderful-wizard-of-oz": theWonderfulWizardOfOz,
    trafalgar,
    "treasure-island": treasureIsland,
    tristana,
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
