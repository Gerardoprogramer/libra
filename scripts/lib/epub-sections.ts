import path from "node:path";

import { load, type CheerioAPI } from "cheerio";

import {
  canonicalMarks,
  deriveChapterContent,
  inlinePlainText,
  normalizeInline,
  type ChapterBlock,
  type FigureImage,
  type HeadingLevel,
  type InlineMark,
  type InlineText,
  type TextBlock,
} from "../../src/lib/chapter-blocks";
import type { ImageIssue, ImageIssueCode } from "./epub-images";

type DomNode = ReturnType<CheerioAPI>[number];
type DomElement = Extract<DomNode, { name: string; attribs: Record<string, string> }>;

function isDomElement(node: DomNode | undefined): node is DomElement {
  return Boolean(node && "name" in node && "attribs" in node);
}

export interface EpubDocument {
  path: string;
  html: string;
  xhtml: boolean;
}

export interface EpubNavigation {
  path: string;
  content: string;
  kind: "nav" | "ncx";
}

interface NavigationEntry {
  label: string;
  href?: string;
  base: string;
  children: NavigationEntry[];
}

interface DocumentIndex {
  path: string;
  $: CheerioAPI;
  start: number;
  end: number;
  elements: DomElement[];
  ids: Map<string, DomElement>;
}

/** The editorial block a piece of text belongs to, inherited down the tree. */
interface BlockContext {
  kind: "paragraph" | "heading" | "listItem";
  level?: HeadingLevel;
  ordered?: boolean;
  quote: boolean;
}

interface VisitContext {
  block: BlockContext;
  marks: InlineMark[];
  /** Inside a figure container whose images were already emitted. */
  inFigure: boolean;
}

/** An illustration found in the text, before its archive path is checked. */
interface FigureToken {
  /** The src attribute as written. */
  reference: string;
  /** Archive path resolved against the document, or null for an external, data: or escaping reference. */
  path: string | null;
  alt: string;
  caption: InlineText[];
}

// Every token keeps the plain `text` the content has always been built from; the other fields only describe it, so
// the blocks are a reading of the same stream and the plain text cannot drift from them.
interface TextToken {
  position: number;
  text: string;
  heading?: DomElement;
  marks?: InlineMark[];
  block?: BlockContext;
  /** A <br/>: a space in the plain text, a line break in verse. */
  lineBreak?: boolean;
  /** An illustration: no text. */
  figure?: FigureToken;
  /** An <hr/>: no text. */
  separator?: boolean;
}

/** What an archive path resolves to: the image, or why it cannot be used. */
export type ImageResolver = (path: string) => FigureImage | { unavailable: ImageIssue };

export interface ExtractionOptions {
  /** Checks figure paths against the archive. Without it every figure keeps its alt and caption but no image. */
  resolveImage?: ImageResolver;
}

interface Boundary {
  position: number;
  title: string;
  ignored: boolean;
  discard?: Classification;
  heading?: DomElement;
  /** Headings that already form the title and are left out of the section text. Defaults to `heading`. */
  omit?: DomElement[];
  level: number;
}

const headings = "h1,h2,h3,h4,h5,h6";
// .caption2/.caption3: ebookmaker's numbered caption classes (the Wizard of Oz uses caption2).
const captions = "figcaption,.caption,.caption2,.caption3,.figcaption,[role='doc-caption']";
// Containers whose images form one illustration with its caption: HTML5 figures and ebookmaker's figure divs.
const figureContainers = "figure,.figcenter,.figleft,.figright,.fig,[role='figure']";
const smallCapsClasses = new Set(["smcap", "smcaps", "smallcaps", "small-caps", "sc"]);
const inlineMarkTags: Record<string, InlineMark> = {
  em: "em",
  i: "em",
  cite: "em",
  dfn: "em",
  var: "em",
  strong: "strong",
  b: "strong",
  sup: "sup",
  sub: "sub",
};
const excluded = `${captions},script,style,nav,svg,figure,.pg-boilerplate,.x-ebookmaker-pageno,[role='doc-pagebreak']`;
const excludedTypes = new Set(["toc", "loi", "lot", "titlepage", "copyright-page", "colophon", "cover", "pagebreak"]);
const blocks = new Set([
  "p",
  "div",
  "section",
  "article",
  "blockquote",
  "pre",
  "li",
  "dt",
  "dd",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function cleanText(value: string) {
  return value
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isBookTitle(value: string, bookTitle: string) {
  const valueKey = comparable(value);
  const bookKey = comparable(bookTitle);

  if (!valueKey || !bookKey) return false;

  if (valueKey === bookKey) {
    return true;
  }

  const shortest = Math.min(valueKey.length, bookKey.length);

  return shortest >= 12 && (valueKey.startsWith(bookKey) || bookKey.startsWith(valueKey));
}

function isByline(title: string) {
  const normalized = cleanText(title);

  return normalized.length <= 100 && /^(?:by|illustrated by)\s+[\p{L}\p{M}.'’\-\s]+$/iu.test(normalized);
}

function normalizeStructuralTitle(value: string) {
  return cleanText(value)
    .replace(/[.:]+$/, "")
    .trim();
}

// Well-formed roman numerals up to 399. A bare run of roman letters is not enough:
// "civil", "mild", "dim" or "did" are words, and "MIX" or "DIM" are headings.
const romanNumeral = /^c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i;

function isRomanNumeral(value: string) {
  return value.length > 0 && romanNumeral.test(value);
}

function isRomanMarker(value: string) {
  const match = /^[\s\-–—]*([ivxlc]+)[\s\-–—]*$/i.exec(normalizeStructuralTitle(value));

  return Boolean(match && isRomanNumeral(match[1]));
}

function isLowercaseRomanMarker(value: string) {
  const normalized = normalizeStructuralTitle(value);

  if (!isRomanMarker(normalized)) {
    return false;
  }

  const letters = normalized.replace(/[^ivxlc]/gi, "");

  return letters.length > 0 && letters === letters.toLowerCase();
}

function isUppercaseRomanMarker(value: string) {
  const normalized = normalizeStructuralTitle(value);

  if (!isRomanMarker(normalized)) {
    return false;
  }

  const letters = normalized.replace(/[^ivxlc]/gi, "");

  return letters.length > 0 && letters === letters.toUpperCase();
}

function isChapterMarker(value: string) {
  const match = /^(?:chapter|cap[ií]tulo)\s+([ivxlc]+)$/iu.exec(normalizeStructuralTitle(value));

  return Boolean(match && isRomanNumeral(match[1]));
}

// The author's closing lines of a part or of the novel: "Madrid.—Enero de 1886." and "FIN DE LA PRIMERA PARTE",
// "FIN DE LA PARTE SEGUNDA", "FIN DE LA NOVELA". Deliberately narrow (capitals, a dated place line, a "FIN DE LA ..."
// formula), so that other books keep discarding whatever they discarded before.
const closingLine = new RegExp(
  String.raw`^(?:\p{Lu}[\p{L} ]*\.\s*[—–-]\s*\p{L}+ de \d{4}\.?\s+)?FIN DE LA (?:PARTE \p{Lu}+|\p{Lu}+ PARTE|NOVELA)$|^\p{Lu}[\p{L} ]*\.\s*[—–-]\s*\p{L}+ de \d{4}\.?$`,
  "u",
);

function isClosingLine(title: string) {
  return closingLine.test(normalizeStructuralTitle(title));
}

function isContents(title: string) {
  return /^(?:contents|table of contents|list of chapters|index|índice(?:\s+general)?|tabla de contenidos?|tabla de capítulos|tabla de capitulos|capítulos|capitulos|sumario)[\s.:]*$/iu.test(
    normalizeStructuralTitle(title),
  );
}

const partWords = new Set(
  [
    // English
    "one,two,three,four,five,six,seven,eight,nine,ten,first,second,third,fourth,fifth,sixth,seventh,eighth,ninth,tenth,final,last",
    // Spanish
    "uno,dos,tres,cuatro,cinco,seis,siete,ocho,nueve,diez,primero,primera,segundo,segunda,tercero,tercera,cuarto,cuarta,quinto,quinta,sexto,sexta,séptimo,séptima,septimo,septima,octavo,octava,noveno,novena,décimo,décima,decimo,decima,único,única,unico,unica,final,última,ultima",
  ].flatMap((list) => list.split(",")),
);

function isPartNumber(token: string) {
  const value = token.toLowerCase();

  return (
    /^\d+(?:ª|º|st|nd|rd|th)?$/.test(value) ||
    partWords.has(value) ||
    (/^[ivxlc]+$/.test(value) && isRomanNumeral(value))
  );
}

// A "Part" divider names its number: "Part II", "Parte primera", "Second Part: The Voyage".
// Titles that merely contain the word ("Parte de la noche", "Take Part in the Hunt") are chapters.
function isPartSection(title: string) {
  const normalized = normalizeStructuralTitle(title).replace(/\s+/g, " ");
  const rest = String.raw`(?![\p{L}\p{N}])(?:(?:\s+|\s*[-–—:.]\s*)\S.*)?$`;
  const forward = new RegExp(String.raw`^(?:parte|part)\s+([\p{L}\p{N}ªº]+)${rest}`, "iu").exec(normalized);
  const reverse = new RegExp(String.raw`^([\p{L}\p{N}ªº]+)\s+(?:parte|part)${rest}`, "iu").exec(normalized);

  return Boolean((forward && isPartNumber(forward[1])) || (reverse && isPartNumber(reverse[1])));
}

export type DiscardReason =
  | "contents"
  | "byline"
  | "title-page"
  | "excluded-markup"
  | "front-matter"
  | "boilerplate"
  | "transcriber-notes"
  | "end-marker"
  | "paratext"
  | "part-divider"
  | "roman-subsection"
  | "no-prose";

interface Classification {
  reason: DiscardReason;
  /** A non-definitive classification is a heuristic: the discarded text must be reviewed if it is substantial. */
  definitive: boolean;
}

function classifyNonReading(title: string): Classification | null {
  const normalized = normalizeStructuralTitle(title);

  if (isContents(title)) return { reason: "contents", definitive: true };
  if (isByline(title)) return { reason: "byline", definitive: true };
  if (isPartSection(title)) return { reason: "part-divider", definitive: false };
  if (isNonChapterSection(title)) return { reason: "paratext", definitive: true };
  if (isLowercaseRomanMarker(title)) return { reason: "roman-subsection", definitive: false };
  if (/^fin de (?:la\s+)?(?:parte|novela)\b/iu.test(normalized)) return { reason: "end-marker", definitive: true };
  if (/^(?:(?:list of )?illustrations|copyright(?: page)?|title page|colophon|credits)[\s.:]*$/iu.test(title)) {
    return { reason: "front-matter", definitive: true };
  }
  if (/^(?:the (?:full )?)?project gutenberg\b.*(?:license|ebook)/i.test(title)) {
    return { reason: "boilerplate", definitive: true };
  }
  if (/\bproject gutenberg collection\b/i.test(title)) return { reason: "boilerplate", definitive: true };
  if (/^transcriber[â€™']?s?\s+notes?\b/i.test(title)) return { reason: "transcriber-notes", definitive: true };

  return null;
}

function isNonReading(title: string) {
  return classifyNonReading(title) !== null;
}

// Only unmistakable paratext: the bare word ("Preface", "Notas"), a parenthetical ("Extracts (Supplied by…)")
// or the word followed by a preposition naming its subject ("Notes on the Text", "Prefacio del traductor").
// "Notes from the Underground" or "Notas de un viajero" are literary titles.
function isNonChapterSection(title: string) {
  const normalized = cleanText(title)
    .replace(/[.:]+$/, "")
    .trim()
    .toLowerCase();
  const heads = String.raw`(?:the\s+)?(?:introduction|preface|foreword|afterword|etymology|extracts?|notes?|notas?|introducción|prefacio)(?![\p{L}\p{N}])`;
  const qualifiers = [
    String.raw`[.:]?\s*[(\[].*`,
    String.raw`\s+(?:to|on|by|about)\b.*`,
    String.raw`\s+of\s+the\s+(?:translator|author|editor|text|edition)\b.*`,
    String.raw`\s+(?:del?|de\s+la)\s+(?:traductor|traductora|autor|autora|editor|editora|edici[oó]n|texto|transcriptor)\b.*`,
    String.raw`\s+(?:al|a\s+la|sobre|para|por)\b.*`,
  ];

  return new RegExp(String.raw`^${heads}(?:${qualifiers.join("|")})?$`, "iu").test(normalized);
}

/** Resolve file and fragment separately; #anchors must never be discarded. */
export function resolveEpubHref(base: string, href: string): { path: string; fragment: string } | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
  const hash = href.indexOf("#");

  try {
    const file = decodeURIComponent((hash < 0 ? href : href.slice(0, hash)).split("?")[0]);
    const resolved = file ? path.posix.normalize(path.posix.join(path.posix.dirname(base), file)) : base;
    if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) return null;
    return { path: resolved, fragment: hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1)) };
  } catch {
    return null;
  }
}

function parseNavigation(source: EpubNavigation): NavigationEntry[] {
  const $ = load(source.content, { xml: true });

  if (source.kind === "ncx") {
    function points(parent: DomElement): NavigationEntry[] {
      return $(parent)
        .children("navPoint")
        .toArray()
        .map((point) => ({
          label: cleanText($(point).children("navLabel").text()),
          href: $(point).children("content").attr("src"),
          base: source.path,
          children: points(point),
        }));
    }
    const navMap = $("navMap").get(0);
    return navMap ? points(navMap) : [];
  }

  function list(element: DomElement): NavigationEntry[] {
    return $(element)
      .children("li")
      .toArray()
      .map((item) => {
        const label = $(item).children("a,span").first();
        return {
          label: cleanText(label.text()),
          href: label.attr("href"),
          base: source.path,
          children: $(item).children("ol,ul").toArray().flatMap(list),
        };
      });
  }

  return $("nav")
    .toArray()
    .filter((nav) => ($(nav).attr("epub:type") ?? "").split(/\s+/).includes("toc") || $(nav).attr("role") === "doc-toc")
    .flatMap((nav) => $(nav).children("ol,ul").toArray().flatMap(list));
}

export interface ExtractedSection {
  title: string;
  content: string;
  /** The same text as typed blocks, plus figures and separators; `content` is always derivable from them. */
  blocks: ChapterBlock[];
}

export interface ImageReport {
  /** Illustrations found in the reading text (decorative heading images and drop capitals excluded). */
  figures: number;
  /** Of those, the ones inside retained sections, now figure blocks. */
  inSections: number;
  /** Figure blocks whose image resolved to a usable file in the archive. */
  resolved: number;
  /**
   * Figure blocks kept without an image, with the reason; their alt and caption are still kept. `path` is the
   * archive path the reference resolved to (null when it points outside the EPUB) and `section` the index of the
   * returned section holding the figure.
   */
  unavailable: { reference: string; path: string | null; section: number; code: ImageIssueCode; reason: string }[];
  /** Drop capitals drawn as images whose letter was restored into the text. */
  dropCaps: number;
  /** Images inside headings, left out as decoration. */
  decorative: number;
  /**
   * Ornaments left out of the text: "enlarge" link icons, images marked role="presentation", drop-cap or ornament
   * classes, deco-* vignettes and ornamental initials whose letter the text already has.
   */
  ornaments: number;
  /** Images of wrapper pages (a page holding only the enlarged version of an image linked from the text). */
  wrapperImages: number;
}

export interface DiscardedSection {
  title: string;
  reason: DiscardReason;
  definitive: boolean;
  /** Approximate number of words in the discarded range, including its heading. */
  words: number;
}

export interface ExtractionReport {
  /** Readable words in the whole spine stream (hidden and excluded markup not counted). */
  totalWords: number;
  /** Words in retained sections, headings included. */
  keptWords: number;
  /** Words in discarded sections listed in `discarded`. */
  discardedWords: number;
  /** Words before the first section boundary; they belong to no section. */
  leadingWords: number;
  /** Numbered subsections ("-ii-") appended to the chapter they continue; counted in keptWords. */
  mergedSubsections: number;
  /** Closing lines of a part ("Madrid.—Enero de 1886.", "FIN DE LA PRIMERA PARTE") appended to its last chapter. */
  closingLines: number;
  discarded: DiscardedSection[];
  /** Navigation entries with a link that does not resolve to any spine document or anchor. */
  unresolvedNavigation: string[];
  /** Conditions that need a human decision before the extraction is trusted. */
  warnings: string[];
  /** Illustrations, drop capitals and decorative images; informational, never a warning yet. */
  images: ImageReport;
}

const REVIEW_WORDS = 100;
// Even a definitive classification deserves a human look when it removes this much text.
const LARGE_DISCARD_WORDS = 1500;
const BULKY_REASONS: readonly DiscardReason[] = ["contents", "boilerplate", "excluded-markup"];
const MAX_DISCARDED_RATIO = 0.15;

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

export function extractEpubSections(
  documents: EpubDocument[],
  navigation: EpubNavigation[],
  bookTitle: string,
  options: ExtractionOptions = {},
) {
  return extractEpubSectionsWithReport(documents, navigation, bookTitle, options).sections;
}

const paragraphContext: VisitContext = { block: { kind: "paragraph", quote: false }, marks: [], inFigure: false };

/** The formatting and block an element gives the text inside it. */
function contextFor($: CheerioAPI, element: DomElement, context: VisitContext): VisitContext {
  const name = element.name.toLowerCase();
  let { block, marks } = context;

  if (/^h[1-6]$/.test(name)) block = { kind: "heading", level: Number(name[1]) as HeadingLevel, quote: block.quote };
  else if (name === "li") block = { kind: "listItem", ordered: $(element).parent().is("ol"), quote: block.quote };
  else if (name === "blockquote") block = { ...block, quote: true };

  const added: InlineMark[] = [];
  if (inlineMarkTags[name]) added.push(inlineMarkTags[name]);
  const classes = (element.attribs.class ?? "").toLowerCase().split(/\s+/);
  if (
    classes.some((name) => smallCapsClasses.has(name)) ||
    /font-variant\s*:\s*small-caps/i.test(element.attribs.style ?? "")
  ) {
    added.push("smallCaps");
  }
  if (added.length) marks = canonicalMarks([...marks, ...added]);

  return block === context.block && marks === context.marks ? context : { ...context, block, marks };
}

/** All text before `image` inside `paragraph`, in document order. */
function textBefore(paragraph: DomNode, image: DomNode): string {
  let text = "";
  let done = false;
  function walk(node: DomNode) {
    if (done) return;
    if (node === image) {
      done = true;
      return;
    }
    if (node.type === "text") text += node.data;
    else if ("children" in node) for (const child of node.children) walk(child);
  }
  walk(paragraph);
  return text;
}

/**
 * The image's file name as its author wrote it: decoded, without directories, extension or the "<digits>_" prefix
 * Project Gutenberg's ebookmaker adds to every file it packages ("6484518377310807417_0033m.jpg" was "0033m.jpg").
 */
function originalFileName(reference: string) {
  let name = reference.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the name as written.
  }
  return name
    .replace(/^\d+_/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase();
}

/**
 * The image's description: its alt text, unless the alt only repeats the file name (with or without its extension,
 * which ebookmaker writes when a source image has no description), which describes nothing.
 */
function imageAlt(image: DomElement) {
  const alt = cleanText(image.attribs.alt ?? "");
  const name = originalFileName(image.attribs.src ?? "");
  const altName = alt.toLowerCase().replace(/\.(?:jpe?g|png|gif|webp|svg)$/, "");
  return name && altName === name ? "" : alt;
}

// Class names that mark an image as ornament rather than illustration (ebookmaker and common EPUB conventions),
// with the numbered variants stylesheets add ("drop-cap2" in The Adventures of Sherlock Holmes).
const ornamentClass =
  /^(?:drop[-_]?(?:cap|img|image)s?|dropcap|ornaments?|ornamental|decorations?|decorative|vignettes?|enlarge(?:[-_]?image)?)\d*$/i;
const ornamentScope = "p,div,li,td,figure,blockquote,section,body";

/**
 * Why an image is ornament and not an illustration, or null. Only the image and its ancestors up to the block it
 * stands in are read, so a class on a whole chapter never turns its illustrations into ornaments.
 */
function ornamentReason($: CheerioAPI, image: DomElement): string | null {
  const name = originalFileName(image.attribs.src ?? "");
  if (/(?:^|[-_])enlarge/.test(name)) return "enlarge icon";
  if (/^deco-\d/.test(name)) return "decorative vignette";

  const scope = $(image).parents().addBack().toArray().reverse().filter(isDomElement);
  for (const element of scope) {
    if (/^(?:presentation|none)$/i.test(element.attribs.role ?? "")) return "presentation";
    if ((element.attribs.class ?? "").split(/\s+/).some((name) => ornamentClass.test(name))) return "ornament class";
    if (element !== image && $(element).is(ornamentScope)) break;
  }
  return null;
}

/** The first non-blank text after `image` inside `paragraph`, in document order. */
function textAfter(paragraph: DomNode, image: DomNode): string {
  let seen = false;
  function walk(node: DomNode): string | null {
    if (node === image) {
      seen = true;
      return null;
    }
    if (node.type === "text") return seen && node.data.trim() ? node.data.trimStart() : null;
    if (!("children" in node)) return null;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== null) return found;
    }
    return null;
  }
  return walk(paragraph) ?? "";
}

/** Caption runs of an element, with the same formatting rules as the text, normalized like a paragraph. */
function captionText($: CheerioAPI, element: DomElement): InlineText[] {
  const runs: InlineText[] = [];
  function walk(node: DomNode, context: VisitContext) {
    if (node.type === "text") {
      runs.push(context.marks.length ? { text: node.data, marks: context.marks } : { text: node.data });
      return;
    }
    if (!isDomElement(node) || $(node).is("img,svg,script,style,.x-ebookmaker-pageno")) return;
    if (node.name === "br") runs.push({ text: " " });
    const inner = contextFor($, node, context);
    for (const child of node.children) walk(child, inner);
  }
  walk(element, paragraphContext);
  return normalizeInline(runs);
}

/**
 * Typed blocks for a run of tokens. The text is split into paragraphs exactly as the plain-text extraction splits it
 * (a blank line, then whitespace collapsed and trimmed), so each text block is one paragraph of that text.
 */
function buildBlocks(tokens: TextToken[], resolveImage: ImageResolver, report: ImageReport): ChapterBlock[] {
  interface Run {
    start: number;
    end: number;
    marks: InlineMark[];
    block: BlockContext;
    lineBreak: boolean;
  }
  interface Marker {
    offset: number;
    token: TextToken;
  }

  let joined = "";
  const runs: Run[] = [];
  const markers: Marker[] = [];
  for (const token of tokens) {
    if (token.figure || token.separator) {
      markers.push({ offset: joined.length, token });
      continue;
    }
    if (!token.text) continue;
    runs.push({
      start: joined.length,
      end: joined.length + token.text.length,
      marks: token.marks ?? [],
      block: token.block ?? paragraphContext.block,
      lineBreak: Boolean(token.lineBreak),
    });
    joined += token.text;
  }

  // Paragraph ranges: what lies between blank lines, as String.split(/\n\s*\n/) would cut it.
  const pieces: { start: number; end: number }[] = [];
  let from = 0;
  for (const match of joined.matchAll(/\n\s*\n/g)) {
    pieces.push({ start: from, end: match.index });
    from = match.index + match[0].length;
  }
  pieces.push({ start: from, end: joined.length });

  type Item = { key: number; rank: number; sequence: number; block: ChapterBlock };
  const items: Item[] = [];
  const placed = new Set<Marker>();
  let sequence = 0;
  let runIndex = 0;

  for (const piece of pieces) {
    const lines: InlineText[][] = [[]];
    let block: BlockContext | undefined;
    let textStart = -1;
    let textEnd = -1;

    while (runIndex < runs.length && runs[runIndex].end <= piece.start) runIndex++;
    for (let index = runIndex; index < runs.length && runs[index].start < piece.end; index++) {
      const run = runs[index];
      const start = Math.max(run.start, piece.start);
      const end = Math.min(run.end, piece.end);
      const text = joined.slice(start, end);
      const firstVisible = text.search(/[^\s ]/);
      if (firstVisible >= 0) {
        if (textStart < 0) {
          textStart = start + firstVisible;
          block = run.block;
        }
        textEnd = start + text.trimEnd().length;
      }
      if (run.lineBreak) lines.push([]);
      lines.at(-1)!.push(run.marks.length ? { text, marks: run.marks } : { text });
    }

    const plain = cleanText(joined.slice(piece.start, piece.end));
    if (plain && block) {
      const normalizedLines = lines.map(normalizeInline).filter((line) => line.length > 0);
      const content = normalizeInline(lines.flat());
      let textBlock: TextBlock;
      if (block.kind === "heading") textBlock = { type: "heading", level: block.level!, content };
      else if (block.kind === "listItem") textBlock = { type: "listItem", ordered: Boolean(block.ordered), content };
      else if (normalizedLines.length > 1) textBlock = { type: "verse", lines: normalizedLines };
      else if (block.quote) textBlock = { type: "quote", content };
      else textBlock = { type: "paragraph", content };

      const text =
        textBlock.type === "verse"
          ? textBlock.lines.map(inlinePlainText).join(" ")
          : inlinePlainText(textBlock.content);
      if (text !== plain) {
        throw new Error(
          `EPUB extraction failed: a block's text diverges from the plain text (${JSON.stringify(plain)}).`,
        );
      }
      items.push({ key: textStart, rank: 1, sequence: sequence++, block: textBlock });
    }

    // Markers inside a paragraph go before it when they precede its text, after it otherwise; the rest by position.
    for (const marker of markers) {
      if (marker.offset < piece.start || marker.offset > piece.end || placed.has(marker)) continue;
      placed.add(marker);
      const key = textStart < 0 || marker.offset <= textStart ? marker.offset : textEnd;
      const rank = textStart >= 0 && marker.offset <= textStart ? 0 : 2;
      items.push({ key, rank, sequence: sequence++, block: markerBlock(marker.token, resolveImage, report) });
    }
  }
  // Markers in the blank lines between paragraphs.
  for (const marker of markers) {
    if (placed.has(marker)) continue;
    items.push({
      key: marker.offset,
      rank: 0,
      sequence: sequence++,
      block: markerBlock(marker.token, resolveImage, report),
    });
  }

  items.sort((first, second) => first.key - second.key || first.rank - second.rank || first.sequence - second.sequence);

  // A separator only separates: none at either end, never two in a row.
  const result: ChapterBlock[] = [];
  for (const { block } of items) {
    if (block.type === "separator" && (result.length === 0 || result.at(-1)!.type === "separator")) continue;
    result.push(block);
  }
  while (result.at(-1)?.type === "separator") result.pop();
  return result;
}

function markerBlock(token: TextToken, resolveImage: ImageResolver, report: ImageReport): ChapterBlock {
  if (!token.figure) return { type: "separator" };
  const { reference, path, alt, caption } = token.figure;
  report.inSections++;
  const resolved =
    path === null
      ? { unavailable: { code: "outside-epub" as const, message: "not a path inside the EPUB" } }
      : resolveImage(path);
  if ("unavailable" in resolved) {
    // The section is set by sectionBetween, which knows which section these blocks belong to.
    report.unavailable.push({
      reference,
      path,
      section: -1,
      code: resolved.unavailable.code,
      reason: resolved.unavailable.message,
    });
    return { type: "figure", image: null, alt, caption };
  }
  report.resolved++;
  return { type: "figure", image: resolved, alt, caption };
}

const noArchive: ImageResolver = () => ({
  unavailable: { code: "missing", message: "no archive to resolve images against" },
});

/** Chapter ranges use one ordered spine stream, so a section can cross XHTML files. */
export function extractEpubSectionsWithReport(
  documents: EpubDocument[],
  navigation: EpubNavigation[],
  bookTitle: string,
  { resolveImage = noArchive }: ExtractionOptions = {},
): { sections: ExtractedSection[]; report: ExtractionReport } {
  let cursor = 0;
  const unresolvedNavigation: string[] = [];
  const positions = new Map<DomNode, number>();
  const tokens: TextToken[] = [];
  const indexes: DocumentIndex[] = [];
  const images: ImageReport = {
    figures: 0,
    inSections: 0,
    resolved: 0,
    unavailable: [],
    dropCaps: 0,
    decorative: 0,
    ornaments: 0,
    wrapperImages: 0,
  };

  function headingText($: CheerioAPI, element: DomElement, removeCaptions = true) {
    const clone = $(element).clone();
    if (removeCaptions) clone.find(captions).remove();
    clone.find("img,svg,.x-ebookmaker-pageno").remove();
    clone.find("br").replaceWith(" ");
    return cleanText(clone.text());
  }

  function captionHeading($: CheerioAPI, element: DomElement) {
    if (!$(element).is(headings)) return false;
    const previous = $(element).prev();
    const alt = previous.is("figure,.fig,.figcenter,.figleft,.figright")
      ? previous.find("img").first().attr("alt")
      : undefined;
    return Boolean(alt && comparable(alt) === comparable(headingText($, element)));
  }

  // The element a role="figure" container names as its caption (aria-labelledby), whatever its class.
  function labelledCaption($: CheerioAPI, element: DomElement) {
    const id = element.attribs.id;
    if (!id) return false;
    const figure = $(element).parent().closest("[role='figure'][aria-labelledby]");
    return figure.length > 0 && (figure.attr("aria-labelledby") ?? "").split(/\s+/).includes(id);
  }

  function excludedElement($: CheerioAPI, element: DomElement) {
    const types = ($(element).attr("epub:type") ?? "").split(/\s+/);
    return (
      $(element).is(excluded) ||
      types.some((type) => excludedTypes.has(type)) ||
      captionHeading($, element) ||
      labelledCaption($, element)
    );
  }

  /** One figure token per illustration of a figure container (ornaments left out); the caption goes with the last. */
  function figureTokens($: CheerioAPI, container: DomElement, documentPath: string): FigureToken[] {
    const illustrations = $(container)
      .find("img")
      .toArray()
      .filter(isDomElement)
      .filter((image) => {
        if (!ornamentReason($, image)) return true;
        images.ornaments++;
        return false;
      });
    const captionElements = $(container)
      .find("*")
      .toArray()
      .filter(isDomElement)
      .filter((element) => $(element).is(captions) || labelledCaption($, element));
    // A caption nested in another caption is read once, with its parent.
    const outer = captionElements.filter(
      (element) => !captionElements.some((other) => other !== element && $(other).find(element).length),
    );
    const caption = normalizeInline(outer.flatMap((element) => [...captionText($, element), { text: " " }]));
    return illustrations.map((image, index) => ({
      ...figureReference(image, documentPath),
      caption: index === illustrations.length - 1 ? caption : [],
    }));
  }

  function figureReference(image: DomElement, documentPath: string): Omit<FigureToken, "caption"> {
    const reference = image.attribs.src ?? "";
    const resolved = reference ? resolveEpubHref(documentPath, reference) : null;
    return {
      reference,
      path: resolved && !resolved.fragment ? resolved.path : null,
      alt: imageAlt(image),
    };
  }

  // XHTML self-closing anchors are XML, not unclosed HTML <a> elements.
  const loaded = documents.map((document) => ({
    document,
    $: load(document.html, document.xhtml ? { xml: true } : undefined),
  }));

  // Wrapper pages: spine documents that an image in another document links to, holding an image and no text but
  // links (ebookmaker writes one per illustration it can enlarge, with a "back" link). Their image is the enlarged
  // copy of one already in the text.
  const isWrapperPage = ($: CheerioAPI) => {
    const body = $("body");
    if (!body.find("img").length) return false;
    const clone = body.clone();
    clone.find("a").remove();
    return !cleanText(clone.text());
  };
  const wrapperPages = new Set<string>();
  const loadedByPath = new Map(loaded.map((item) => [item.document.path, item]));
  for (const { document, $ } of loaded) {
    for (const link of $("a[href]").toArray().filter(isDomElement)) {
      if (!$(link).find("img").length) continue;
      const target = resolveEpubHref(document.path, link.attribs.href);
      const page = target && target.path !== document.path ? loadedByPath.get(target.path) : undefined;
      if (page && isWrapperPage(page.$)) wrapperPages.add(target!.path);
    }
  }

  for (const { document, $ } of loaded) {
    const wrapper = wrapperPages.has(document.path);
    const body = $("body").get(0);
    if (!body) {
      throw new Error(`EPUB validation failed: spine document has no readable body: ${document.path}`);
    }
    const index: DocumentIndex = { path: document.path, $, start: cursor, end: cursor, elements: [], ids: new Map() };

    // Images are read where they stand: a drop capital gives back its letter, an image in a heading is decoration,
    // an ornament is left out, a figure container or a lone image becomes an illustration.
    function visitImage(node: DomElement, position: number, heading: DomElement | undefined, context: VisitContext) {
      if (heading) {
        images.decorative++;
        return;
      }
      if (context.inFigure) return;

      // The drawn letter is read from the alt as written: a letter image is often named after its letter ("t.png").
      const writtenAlt = cleanText(node.attribs.alt ?? "");
      const alt = imageAlt(node);
      const paragraph = $(node).closest("p").get(0);
      // One or two letters, possibly after punctuation that opens the sentence ("“I" + " hope, my dear").
      const drawn = writtenAlt.match(/^(\p{P}*)(\p{L}{1,2})$/u);
      if (paragraph && drawn) {
        // The letter is drawn: the text goes on with the rest of the word ("T" + "HE discussion"). If the text
        // already repeats the letter, the image is only ornament and adds nothing; punctuation the text already has
        // before the image is not repeated.
        const [, punctuation, letters] = drawn;
        const following = textAfter(paragraph, node);
        if (/^\p{L}/u.test(following)) {
          images.dropCaps++;
          if (!following.toLowerCase().startsWith(letters.toLowerCase())) {
            const before = textBefore(paragraph, node).trimEnd();
            const text = punctuation && before.endsWith(punctuation) ? letters : writtenAlt;
            tokens.push({ position, text, heading, marks: context.marks, block: context.block });
          }
          return;
        }
      }

      // An initial drawn without its letter at the start of a paragraph that already has it ("ELIZABETH…").
      const ornamentalInitial =
        !alt &&
        paragraph !== undefined &&
        /^\p{L}/u.test(textAfter(paragraph, node)) &&
        !/[\p{L}\p{N}]/u.test(textBefore(paragraph, node));
      if (ornamentalInitial || ornamentReason($, node)) {
        images.ornaments++;
        return;
      }

      images.figures++;
      tokens.push({ position, text: "", heading, figure: { ...figureReference(node, document.path), caption: [] } });
    }

    function visit(node: DomNode, heading?: DomElement, hidden = false, context: VisitContext = paragraphContext) {
      const position = cursor++;
      positions.set(node, position);
      if (node.type === "text") {
        if (!hidden) tokens.push({ position, text: node.data, heading, marks: context.marks, block: context.block });
        return;
      }
      if (!("children" in node)) return;
      if ("name" in node) {
        index.elements.push(node);
        for (const id of [node.attribs.id, node.name === "a" ? node.attribs.name : undefined]) {
          if (id && !index.ids.has(id)) index.ids.set(id, node);
        }
        // Before hiding: <figure> itself is excluded markup, but its images are the illustration.
        if (!hidden && !context.inFigure && $(node).is(figureContainers) && $(node).find("img").length) {
          if (heading || $(node).closest(headings).length) {
            images.decorative += $(node).find("img").length;
          } else {
            for (const figure of figureTokens($, node, document.path)) {
              images.figures++;
              tokens.push({ position, text: "", heading, figure });
            }
          }
          context = { ...context, inFigure: true };
        }
        hidden ||= excludedElement($, node);
        if ($(node).is(headings)) heading = node;
        context = contextFor($, node, context);
        if (!hidden && node.name === "img") visitImage(node, position, heading, context);
        if (!hidden && node.name === "hr") tokens.push({ position, text: "", heading, separator: true });
        if (!hidden && blocks.has(node.name)) tokens.push({ position, text: "\n\n", heading });
        if (!hidden && node.name === "br") {
          tokens.push({ position, text: " ", heading, lineBreak: true, marks: context.marks, block: context.block });
        }
        if (!hidden && (node.name === "td" || node.name === "th")) tokens.push({ position, text: " ", heading });
      }
      for (const child of node.children) visit(child, heading, hidden, context);
      const end = cursor++;
      if (!hidden && "name" in node && blocks.has(node.name)) tokens.push({ position: end, text: "\n\n", heading });
    }

    // A wrapper page is read as hidden markup: neither its image nor its "back" link is part of the text.
    if (wrapper) images.wrapperImages += $("body img").length;
    visit(body, undefined, wrapper);
    index.end = cursor;
    indexes.push(index);
  }

  const byPath = new Map(indexes.map((document) => [document.path, document]));
  function tokensBetween(start: number, end: number, omitted?: DomElement[], proseOnly = false) {
    return tokens.filter(
      (token) =>
        token.position >= start &&
        token.position < end &&
        !(token.heading && omitted?.includes(token.heading)) &&
        (!proseOnly || !token.heading),
    );
  }

  function textBetween(start: number, end: number, omitted?: DomElement[], proseOnly = false) {
    return tokensBetween(start, end, omitted, proseOnly)
      .map((token) => token.text)
      .join("")
      .split(/\n\s*\n/)
      .map(cleanText)
      .filter(Boolean)
      .join("\n\n");
  }

  /** The text of a range and its blocks, read from the same tokens; the blocks must give back that exact text. */
  function sectionBetween(start: number, end: number, section: number, omitted?: DomElement[]) {
    const text = textBetween(start, end, omitted);
    const reported = images.unavailable.length;
    const sectionBlocks = buildBlocks(tokensBetween(start, end, omitted), resolveImage, images);
    if (deriveChapterContent(sectionBlocks) !== text) {
      throw new Error("EPUB extraction failed: the chapter blocks do not reproduce the chapter text.");
    }
    for (const item of images.unavailable.slice(reported)) item.section = section;
    return { text, blocks: sectionBlocks };
  }

  // Title headings already folded into the boundary of their roman marker; they never start a chapter themselves.
  const mergedTitleHeadings = new Set<DomElement>();

  function mergeRomanChapterHeading(
    document: DocumentIndex,
    position: number,
    heading: DomElement | undefined,
    title: string,
  ): { position: number; heading: DomElement | undefined; title: string; omit?: DomElement[] } {
    if (!heading) {
      return {
        position,
        heading,
        title,
      };
    }

    const headingElements = document.elements.filter((element) => document.$(element).is(headings));

    const headingIndex = headingElements.indexOf(heading);

    if (headingIndex < 0) {
      return {
        position,
        heading,
        title,
      };
    }

    const headingTitle = headingText(document.$, heading);

    // Case 1:
    // -I-
    // Chapter title
    //
    // Combine both headings into one chapter boundary.
    if (isUppercaseRomanMarker(headingTitle) || isChapterMarker(headingTitle)) {
      const nextHeading = headingElements[headingIndex + 1];

      if (!nextHeading) {
        return {
          position,
          heading,
          title,
        };
      }

      const nextPosition = positions.get(nextHeading)!;
      const nextTitle = headingText(document.$, nextHeading);

      if (
        !nextTitle ||
        isRomanMarker(nextTitle) ||
        isNonReading(nextTitle) ||
        textBetween(position, nextPosition, undefined, true)
      ) {
        return {
          position,
          heading,
          title,
        };
      }

      // The boundary stays on the marker: starting at the title would leave the marker at the end of the
      // previous section. Both headings become the chapter title, so neither belongs to its text.
      mergedTitleHeadings.add(nextHeading);

      return {
        position,
        heading: nextHeading,
        title: `${headingTitle} ${nextTitle}`,
        omit: [heading, nextHeading],
      };
    }

    // Case 2:
    // Chapter marker
    // Chapter title
    //
    // Some EPUBs keep the chapter number and title in separate headings,
    // while navigation points directly to the title heading.
    if (headingIndex > 0) {
      const previousHeading = headingElements[headingIndex - 1];

      const previousTitle = headingText(document.$, previousHeading);
      const previousPosition = positions.get(previousHeading)!;

      if (
        isChapterMarker(previousTitle) &&
        !isNonReading(headingTitle) &&
        !isRomanMarker(headingTitle) &&
        !textBetween(previousPosition, position, undefined, true)
      ) {
        return {
          position,
          heading,
          title: `${previousTitle} ${headingTitle}`,
        };
      }
    }

    // Case 2:
    // Chapter title
    // -i-
    //
    // The EPUB navigation may point directly to the lowercase
    // subsection. Reconstruct the parent chapter from the two
    // headings immediately before it.
    if (isLowercaseRomanMarker(headingTitle)) {
      const chapterTitleHeading = headingElements[headingIndex - 1];
      const chapterMarkerHeading = headingElements[headingIndex - 2];

      if (!chapterTitleHeading || !chapterMarkerHeading) {
        return {
          position,
          heading,
          title,
        };
      }

      const chapterTitle = headingText(document.$, chapterTitleHeading);

      const chapterMarker = headingText(document.$, chapterMarkerHeading);

      if (!chapterTitle || !chapterMarker || !isUppercaseRomanMarker(chapterMarker) || isRomanMarker(chapterTitle)) {
        return {
          position,
          heading,
          title,
        };
      }

      mergedTitleHeadings.add(chapterTitleHeading);

      return {
        position: positions.get(chapterMarkerHeading)!,
        heading: chapterTitleHeading,
        title: `${chapterMarker} ${chapterTitle}`,
        omit: [chapterMarkerHeading, chapterTitleHeading],
      };
    }

    return {
      position,
      heading,
      title,
    };
  }

  function resolveEntry(entry: NavigationEntry): Boundary | null {
    if (!entry.href) return null;
    const href = resolveEpubHref(entry.base, entry.href);
    const document = href && byPath.get(href.path);
    if (!href || !document) return null;
    const { $ } = document;
    const rawTarget = href.fragment ? document.ids.get(href.fragment) : $("body").get(0);

    if (!rawTarget || !isDomElement(rawTarget)) return null;

    const target = rawTarget;

    let position = positions.get(target)!;

    const rawHeading = $(target).closest(headings).get(0);

    let heading: DomElement | undefined = isDomElement(rawHeading) ? rawHeading : undefined;

    if (!heading) {
      const next = document.elements.find((element) => positions.get(element)! >= position && $(element).is(headings));
      if (next && !textBetween(position, positions.get(next)!, undefined, true)) heading = next;
    }
    if (heading) position = positions.get(heading)!;

    const cleanHeading = heading ? headingText($, heading) : "";
    let title = entry.label || cleanHeading;
    const mergedHeading = mergeRomanChapterHeading(document, position, heading, title);

    position = mergedHeading.position;
    heading = mergedHeading.heading;
    title = mergedHeading.title;
    const omit = mergedHeading.omit;
    // Auto-generated TOCs may copy a heading including its illustration caption.
    if (heading && $(heading).find(captions).length && cleanText(title) === headingText($, heading, false))
      title = cleanHeading;
    const titlePage =
      heading &&
      (isBookTitle(cleanHeading, bookTitle) ||
        $(heading).closest(".title,.title2,[epub\\:type~='titlepage']").length > 0);
    const hidden = $(target)
      .parents()
      .addBack()
      .toArray()
      .some((element) => isDomElement(element) && excludedElement($, element));

    const discard: Classification | null = titlePage
      ? { reason: "title-page", definitive: true }
      : hidden
        ? { reason: "excluded-markup", definitive: true }
        : classifyNonReading(title);

    return {
      position,
      title,
      ignored: discard !== null,
      ...(discard ? { discard } : {}),
      heading,
      ...(omit ? { omit } : {}),
      level: heading ? Number(heading.name.slice(1)) : 6,
    };
  }

  const boundaries = new Map<number, Boundary>();
  const protectedRanges: { start: number; end: number }[] = [];
  function firstPosition(entry: NavigationEntry): number | undefined {
    return (
      resolveEntry(entry)?.position ?? entry.children.map(firstPosition).find((position) => position !== undefined)
    );
  }

  function select(entries: NavigationEntry[], end: number) {
    for (const [index, entry] of entries.entries()) {
      const boundary = resolveEntry(entry);
      const next =
        entries
          .slice(index + 1)
          .map(firstPosition)
          .find((position) => position !== undefined) ?? end;
      if (!boundary && entry.href) {
        const label = entry.label || entry.href;
        if (!unresolvedNavigation.includes(label)) unresolvedNavigation.push(label);
      }
      if (boundary) {
        if (!boundaries.has(boundary.position)) boundaries.set(boundary.position, boundary);
        if (!boundary.ignored && entry.children.length) {
          protectedRanges.push({ start: boundary.position, end: next });
          continue;
        }
      }
      select(entry.children, next);
    }
  }

  const sources = [...navigation].sort(
    (first, second) => (first.kind === "nav" ? 0 : 1) - (second.kind === "nav" ? 0 : 1),
  );
  for (const source of sources) {
    const entries = parseNavigation(source);
    if (entries.some((entry) => firstPosition(entry) !== undefined)) {
      select(entries, cursor);
      break;
    }
  }

  const protectedPosition = (position: number) =>
    protectedRanges.some((range) => position > range.start && position < range.end);

  // A printed HTML TOC can be richer than the generated EPUB nav/NCX (image headings).
  for (const document of indexes) {
    const { $ } = document;
    for (const heading of document.elements.filter(
      (element) => $(element).is(headings) && isContents(headingText($, element)),
    )) {
      const start = positions.get(heading)!;
      const nextHeading = document.elements.find(
        (element) => positions.get(element)! > start && $(element).is(headings),
      );
      const limit = nextHeading ? positions.get(nextHeading)! : document.end;
      const links = document.elements
        .filter(
          (element) =>
            element.name === "a" &&
            element.attribs.href &&
            positions.get(element)! > start &&
            positions.get(element)! < limit,
        )
        .map((element) => ({
          element,
          boundary: resolveEntry({
            label: cleanText($(element).text()),
            href: element.attribs.href,
            base: document.path,
            children: [],
          }),
        }))
        .filter((link) => link.boundary && link.boundary.position > start);
      const contentStart = Math.min(...links.map((link) => link.boundary!.position));

      for (const { element, boundary } of links) {
        if (
          boundary &&
          positions.get(element)! < contentStart &&
          !protectedPosition(boundary.position) &&
          !boundaries.has(boundary.position)
        ) {
          boundaries.set(boundary.position, boundary);
        }
      }
    }
  }

  // Fill missing peers from heading hierarchy without turning a chapter's subheadings into chapters.
  for (const document of indexes) {
    for (const heading of document.elements.filter((element) => document.$(element).is(headings))) {
      let position = positions.get(heading)!;

      if (boundaries.has(position) || protectedPosition(position) || mergedTitleHeadings.has(heading)) continue;

      let title = headingText(document.$, heading);

      if (
        !title ||
        excludedElement(document.$, heading) ||
        document
          .$(heading)
          .parents()
          .toArray()
          .some((element) => excludedElement(document.$, element))
      ) {
        continue;
      }

      const mergedHeading = mergeRomanChapterHeading(document, position, heading, title);

      position = mergedHeading.position;
      title = mergedHeading.title;

      const effectiveHeading = mergedHeading.heading ?? heading;

      if (boundaries.has(position) || protectedPosition(position)) continue;

      const previous = [...boundaries.values()]
        .filter((boundary) => boundary.position < position)
        .sort((a, b) => b.position - a.position)[0];

      const level = Number(effectiveHeading.name.slice(1));

      if (previous && !previous.ignored && level > previous.level && !isNonReading(title)) {
        continue;
      }

      const titlePage =
        isBookTitle(title, bookTitle) ||
        document.$(effectiveHeading).closest(".title,.title2,[epub\\:type~='titlepage']").length > 0;

      const discard: Classification | null = titlePage
        ? { reason: "title-page", definitive: true }
        : classifyNonReading(title);

      boundaries.set(position, {
        position,
        title,
        heading: effectiveHeading,
        ...(mergedHeading.omit ? { omit: mergedHeading.omit } : {}),
        level,
        ignored: discard !== null,
        ...(discard ? { discard } : {}),
      });
    }
  }

  // With no usable navigation or headings, each spine document is a reading unit.
  if (!boundaries.size) {
    for (const [index, document] of indexes.entries()) {
      boundaries.set(document.start, {
        position: document.start,
        title: cleanText(document.$("title").text()) || `Section ${index + 1}`,
        ignored: false,
        level: 6,
      });
    }
  }

  const ordered = [...boundaries.values()].sort((first, second) => first.position - second.position);
  const sections: ExtractedSection[] = [];
  const discarded: DiscardedSection[] = [];
  const wordsIn = (start: number, end: number) => countWords(textBetween(start, end));
  const leadingWords = wordsIn(0, ordered[0]?.position ?? cursor);
  let keptWords = 0;
  let discardedWords = 0;
  let mergedSubsections = 0;
  let closingLines = 0;
  // The section a lowercase roman subsection ("-ii-", "-iii-") continues; any other discard ends it.
  let open: ExtractedSection | null = null;

  for (const [index, boundary] of ordered.entries()) {
    const end = ordered[index + 1]?.position ?? cursor;
    const words = wordsIn(boundary.position, end);
    const discard: Classification | null =
      boundary.discard ??
      (boundary.ignored ? { reason: "excluded-markup", definitive: true } : null) ??
      (!textBetween(boundary.position, end, undefined, true) ? { reason: "no-prose", definitive: true } : null);

    // A numbered subsection is part of its chapter, not structure to throw away.
    if (open && discard?.reason === "roman-subsection") {
      // `open` is the last section returned.
      const part = sectionBetween(boundary.position, end, sections.length - 1);
      open.content += `\n\n${part.text}`;
      open.blocks.push(...part.blocks);
      keptWords += words;
      mergedSubsections++;
      continue;
    }

    // The closing lines of a part belong to the last chapter of that part, after its text, never to a title.
    if (open && discard && words > 0 && isClosingLine(boundary.title)) {
      // `open` is the last section returned.
      const part = sectionBetween(boundary.position, end, sections.length - 1);
      open.content += `\n\n${part.text}`;
      open.blocks.push(...part.blocks);
      keptWords += words;
      closingLines++;
      continue;
    }

    const omitted = boundary.omit ?? (boundary.heading ? [boundary.heading] : undefined);
    const content = discard ? "" : textBetween(boundary.position, end, omitted);

    if (discard || !content) {
      const reason = discard ?? { reason: "no-prose" as const, definitive: true };
      discarded.push({ title: boundary.title, reason: reason.reason, definitive: reason.definitive, words });
      discardedWords += words;
      open = null;
      continue;
    }

    keptWords += words;
    open = {
      title: boundary.title,
      content,
      blocks: sectionBetween(boundary.position, end, sections.length, omitted).blocks,
    };
    sections.push(open);
  }

  const totalWords = countWords(tokens.map((token) => token.text).join(""));
  const warnings: string[] = [];

  for (const item of discarded) {
    if (!item.definitive && item.words >= REVIEW_WORDS) {
      warnings.push(
        `Section "${item.title}" was discarded as ${item.reason} but holds ~${item.words} words; review before importing, the classification is a heuristic.`,
      );
    }
  }
  for (const item of discarded) {
    if (item.definitive && item.words >= LARGE_DISCARD_WORDS && !BULKY_REASONS.includes(item.reason)) {
      warnings.push(
        `Section "${item.title}" (${item.reason}) discards ~${item.words} words; confirm it is not literary text.`,
      );
    }
  }
  if (leadingWords >= REVIEW_WORDS) {
    warnings.push(`~${leadingWords} words of text before the first section belong to no section.`);
  }
  for (const label of unresolvedNavigation) {
    warnings.push(`Navigation entry "${label}" does not resolve to any spine document or anchor.`);
  }
  if (totalWords > 0 && discardedWords / totalWords > MAX_DISCARDED_RATIO) {
    warnings.push(
      `${Math.round((discardedWords / totalWords) * 100)}% of the readable text (~${discardedWords} of ${totalWords} words) was discarded.`,
    );
  }
  if (keptWords + discardedWords + leadingWords !== totalWords) {
    warnings.push(
      `Word accounting mismatch: kept ${keptWords} + discarded ${discardedWords} + leading ${leadingWords} != total ${totalWords}.`,
    );
  }

  return {
    sections,
    report: {
      totalWords,
      keptWords,
      discardedWords,
      leadingWords,
      mergedSubsections,
      closingLines,
      discarded,
      unresolvedNavigation,
      warnings,
      images,
    },
  };
}
