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
  heading?: DomElement;
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

function isRomanMarker(value: string) {
  const normalized = normalizeStructuralTitle(value);

  return /^[\s\-–—]*[ivxlcdm]+[\s\-–—]*$/i.test(normalized);
}

function isLowercaseRomanMarker(value: string) {
  const normalized = normalizeStructuralTitle(value);

  if (!isRomanMarker(normalized)) {
    return false;
  }

  const letters = normalized.replace(/[^ivxlcdm]/gi, "");

  return letters.length > 0 && letters === letters.toLowerCase();
}

function isUppercaseRomanMarker(value: string) {
  const normalized = normalizeStructuralTitle(value);

  if (!isRomanMarker(normalized)) {
    return false;
  }

  const letters = normalized.replace(/[^ivxlcdm]/gi, "");

  return letters.length > 0 && letters === letters.toUpperCase();
}

function isChapterMarker(value: string) {
  const normalized = normalizeStructuralTitle(value);

  return /^(?:chapter|cap[ií]tulo)\s+[ivxlcdm]+$/iu.test(normalized);
}

function isContents(title: string) {
  return /^(?:contents|table of contents|list of chapters|index|índice(?:\s+general)?|tabla de contenidos?|tabla de capítulos|tabla de capitulos|capítulos|capitulos|sumario)[\s.:]*$/iu.test(
    normalizeStructuralTitle(title),
  );
}

function isPartSection(title: string) {
  const normalized = normalizeStructuralTitle(title).replace(/\s+/g, " ");

  return (
    /^(?:parte|part)\s+(?:[ivxlcdm]+|\d+|[\p{L}]+)(?:(?:\s+|[-–—:])\S.*)?$/iu.test(normalized) ||
    /^(?:[ivxlcdm]+|\d+|[\p{L}]+)\s+(?:parte|part)(?:(?:\s+|[-–—:])\S.*)?$/iu.test(normalized)
  );
}

function isNonReading(title: string) {
  return (
    isContents(title) ||
    isByline(title) ||
    isPartSection(title) ||
    isNonChapterSection(title) ||
    isLowercaseRomanMarker(title) ||
    /^fin de (?:la\s+)?(?:parte|novela)\b/iu.test(normalizeStructuralTitle(title)) ||
    /^(?:(?:list of )?illustrations|copyright(?: page)?|title page|colophon|credits)[\s.:]*$/iu.test(title) ||
    /^(?:the (?:full )?)?project gutenberg\b.*(?:license|ebook)/i.test(title) ||
    /\bproject gutenberg collection\b/i.test(title) ||
    /^transcriber[â€™']?s?\s+notes?\b/i.test(title)
  );
}

function isNonChapterSection(title: string) {
  const normalized = cleanText(title)
    .replace(/[.:]+$/, "")
    .trim()
    .toLowerCase();

  return /^(?:the\s+)?(?:introduction|preface|foreword|prologue|epilogue|afterword|etymology|extracts?|notes?|notas?|introducción|prefacio|prólogo|epílogo)(?:\b.*)?$/iu.test(
    normalized,
  );
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

/** Chapter ranges use one ordered spine stream, so a section can cross XHTML files. */
export function extractEpubSections(documents: EpubDocument[], navigation: EpubNavigation[], bookTitle: string) {
  let cursor = 0;
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
    if (!body) continue;
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
  function textBetween(start: number, end: number, omittedHeading?: DomElement, proseOnly = false) {
    return tokens
      .filter(
        (token) =>
          token.position >= start &&
          token.position < end &&
          (!omittedHeading || token.heading !== omittedHeading) &&
          (!proseOnly || !token.heading),
      )
      .map((token) => token.text)
      .join("")
      .split(/\n\s*\n/)
      .map(cleanText)
      .filter(Boolean)
      .join("\n\n");
  }

  function mergeRomanChapterHeading(
    document: DocumentIndex,
    position: number,
    heading: DomElement | undefined,
    title: string,
  ) {
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

      return {
        position: nextPosition,
        heading: nextHeading,
        title: `${headingTitle} ${nextTitle}`,
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

      return {
        position: positions.get(chapterTitleHeading)!,
        heading: chapterTitleHeading,
        title: `${chapterMarker} ${chapterTitle}`,
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

    return {
      position,
      title,
      ignored: Boolean(titlePage || hidden || isNonReading(title)),
      heading,
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

      if (boundaries.has(position) || protectedPosition(position)) continue;

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

      boundaries.set(position, {
        position,
        title,
        heading: effectiveHeading,
        level,
        ignored: Boolean(titlePage || isNonReading(title)),
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
  return ordered.flatMap((boundary, index) => {
    if (boundary.ignored || isNonChapterSection(boundary.title)) {
      return [];
    }

    const end = ordered[index + 1]?.position ?? cursor;

    if (!textBetween(boundary.position, end, undefined, true)) return [];

    const content = textBetween(boundary.position, end, boundary.heading);

    return content ? [{ title: boundary.title, content }] : [];
  });
}
