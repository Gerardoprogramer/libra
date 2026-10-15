import path from "node:path";

import { load, type CheerioAPI } from "cheerio";

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

interface TextToken {
  position: number;
  text: string;
  heading?: DomElement;
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
const captions = "figcaption,.caption,.figcaption,[role='doc-caption']";
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
}

const REVIEW_WORDS = 100;
// Even a definitive classification deserves a human look when it removes this much text.
const LARGE_DISCARD_WORDS = 1500;
const BULKY_REASONS: readonly DiscardReason[] = ["contents", "boilerplate", "excluded-markup"];
const MAX_DISCARDED_RATIO = 0.15;

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

export function extractEpubSections(documents: EpubDocument[], navigation: EpubNavigation[], bookTitle: string) {
  return extractEpubSectionsWithReport(documents, navigation, bookTitle).sections;
}

/** Chapter ranges use one ordered spine stream, so a section can cross XHTML files. */
export function extractEpubSectionsWithReport(
  documents: EpubDocument[],
  navigation: EpubNavigation[],
  bookTitle: string,
): { sections: ExtractedSection[]; report: ExtractionReport } {
  let cursor = 0;
  const unresolvedNavigation: string[] = [];
  const positions = new Map<DomNode, number>();
  const tokens: TextToken[] = [];
  const indexes: DocumentIndex[] = [];

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

  function excludedElement($: CheerioAPI, element: DomElement) {
    const types = ($(element).attr("epub:type") ?? "").split(/\s+/);
    return $(element).is(excluded) || types.some((type) => excludedTypes.has(type)) || captionHeading($, element);
  }

  for (const document of documents) {
    // XHTML self-closing anchors are XML, not unclosed HTML <a> elements.
    const $ = load(document.html, document.xhtml ? { xml: true } : undefined);
    const body = $("body").get(0);
    if (!body) {
      throw new Error(`EPUB validation failed: spine document has no readable body: ${document.path}`);
    }
    const index: DocumentIndex = { path: document.path, $, start: cursor, end: cursor, elements: [], ids: new Map() };

    function visit(node: DomNode, heading?: DomElement, hidden = false) {
      const position = cursor++;
      positions.set(node, position);
      if (node.type === "text") {
        if (!hidden) tokens.push({ position, text: node.data, heading });
        return;
      }
      if (!("children" in node)) return;
      if ("name" in node) {
        index.elements.push(node);
        for (const id of [node.attribs.id, node.name === "a" ? node.attribs.name : undefined]) {
          if (id && !index.ids.has(id)) index.ids.set(id, node);
        }
        hidden ||= excludedElement($, node);
        if ($(node).is(headings)) heading = node;
        if (!hidden && blocks.has(node.name)) tokens.push({ position, text: "\n\n", heading });
        if (!hidden && (node.name === "br" || node.name === "td" || node.name === "th"))
          tokens.push({ position, text: " ", heading });
      }
      for (const child of node.children) visit(child, heading, hidden);
      const end = cursor++;
      if (!hidden && "name" in node && blocks.has(node.name)) tokens.push({ position: end, text: "\n\n", heading });
    }

    visit(body);
    index.end = cursor;
    indexes.push(index);
  }

  const byPath = new Map(indexes.map((document) => [document.path, document]));
  function textBetween(start: number, end: number, omitted?: DomElement[], proseOnly = false) {
    return tokens
      .filter(
        (token) =>
          token.position >= start &&
          token.position < end &&
          !(token.heading && omitted?.includes(token.heading)) &&
          (!proseOnly || !token.heading),
      )
      .map((token) => token.text)
      .join("")
      .split(/\n\s*\n/)
      .map(cleanText)
      .filter(Boolean)
      .join("\n\n");
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
      open.content += `\n\n${textBetween(boundary.position, end)}`;
      keptWords += words;
      mergedSubsections++;
      continue;
    }

    // The closing lines of a part belong to the last chapter of that part, after its text, never to a title.
    if (open && discard && words > 0 && isClosingLine(boundary.title)) {
      open.content += `\n\n${textBetween(boundary.position, end)}`;
      keptWords += words;
      closingLines++;
      continue;
    }

    const content = discard
      ? ""
      : textBetween(boundary.position, end, boundary.omit ?? (boundary.heading ? [boundary.heading] : undefined));

    if (discard || !content) {
      const reason = discard ?? { reason: "no-prose" as const, definitive: true };
      discarded.push({ title: boundary.title, reason: reason.reason, definitive: reason.definitive, words });
      discardedWords += words;
      open = null;
      continue;
    }

    keptWords += words;
    open = { title: boundary.title, content };
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
    },
  };
}
