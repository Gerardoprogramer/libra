import { createHash } from "node:crypto";

import { load } from "cheerio";
import JSZip from "jszip";

import type { ExtractionReport } from "./epub-sections";
import { parseEpub, type ParseOptions } from "./parse-epub";

// A fingerprint of what the current parser makes of each catalogue EPUB, so a later extraction can be compared with
// it chapter by chapter. It is recorded from the local, untracked imports/ files with
// `pnpm exec tsx scripts/record-epub-corpus-baseline.ts [directory]` and checked by epub-corpus-baseline.test.ts.
// Nothing here writes to PostgreSQL or R2, and the EPUBs are only read.

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export interface ChapterFingerprint {
  number: number;
  slug: string;
  title: string;
  wordCount: number;
  /** SHA-256 of the exact chapter text the importer would store. */
  contentSha256: string;
  /** Paragraphs as the reader splits them (blank-line separated): the unit of saved reading positions. */
  paragraphs: number;
  /** SHA-256 of the chapter's typed blocks (JSON), so a change in structure is caught even when the text is equal. */
  blocksSha256: string;
  /** Figure blocks in the chapter, and how many of them have a usable image. */
  figures: number;
  figuresWithImage: number;
}

/**
 * Counts taken from the raw spine markup, not from the extraction: they describe what the EPUB contains, so the
 * future extraction can be checked against them. They are measurements of the file, not of what reached a reader.
 */
export interface MarkupInventory {
  /** <img> elements in spine documents. */
  images: number;
  /** <img> elements whose alt is one or two letters inside a paragraph: drop capitals drawn as images. */
  letterImages: number;
  /** <img> elements inside a heading. */
  headingImages: number;
  /** figure elements and Gutenberg figure containers (div.figcenter/.figleft/.figright/.fig, role="figure"). */
  figures: number;
  /** figcaption elements and elements with a caption class (caption, caption2…). */
  captions: number;
  /** <img>, <image> or <svg> references to a scheme, protocol-relative or data: URL. */
  externalReferences: number;
  /** Image files stored in the archive, whatever references them. */
  archiveImages: number;
}

export interface EpubFingerprint {
  fileSha256: string;
  bytes: number;
  title: string;
  language: string;
  chapters: ChapterFingerprint[];
  totalWords: number;
  keptWords: number;
  discardedWords: number;
  leadingWords: number;
  warnings: number;
  cover: { mediaType: string; bytes: number; sha256: string } | null;
  markup: MarkupInventory;
  /** The extraction's own image report (see ExtractionReport.images). */
  images: ExtractionReport["images"];
}

async function inventory(buffer: Buffer): Promise<MarkupInventory> {
  const zip = await JSZip.loadAsync(buffer);
  const counts: MarkupInventory = {
    images: 0,
    letterImages: 0,
    headingImages: 0,
    figures: 0,
    captions: 0,
    externalReferences: 0,
    archiveImages: 0,
  };
  const opfPath = (await zip.file("META-INF/container.xml")?.async("string"))?.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? await zip.file(opfPath)?.async("string") : undefined;
  const base = opfPath?.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const $opf = load(opf ?? "", { xml: true });
  const manifest = new Map(
    $opf("manifest > item")
      .toArray()
      .map((item) => [$opf(item).attr("id"), $opf(item)] as const),
  );
  const spine = $opf("spine > itemref")
    .toArray()
    .map((ref) => manifest.get($opf(ref).attr("idref")))
    .filter(
      (item) => item && /html/.test(item.attr("media-type") ?? "") && !/\bnav\b/.test(item.attr("properties") ?? ""),
    )
    .map((item) => decodeURIComponent(`${base}${item!.attr("href")}`));

  for (const name of Object.keys(zip.files)) {
    if (/\.(?:jpe?g|png|gif|webp|svg)$/i.test(name)) counts.archiveImages++;
  }
  for (const path of spine) {
    const html = await zip.file(path)?.async("string");
    if (!html) continue;
    const $ = load(html, { xml: true });
    $("img").each((_, element) => {
      counts.images++;
      const alt = $(element).attr("alt") ?? "";
      if (/^\p{L}{1,2}$/u.test(alt) && $(element).closest("p").length > 0) counts.letterImages++;
      if ($(element).closest("h1,h2,h3,h4,h5,h6").length > 0) counts.headingImages++;
    });
    counts.figures += $("figure, .figcenter, .figleft, .figright, .fig, [role='figure']").length;
    counts.captions += $("figcaption, [class]")
      .toArray()
      .filter(
        (element) => element.tagName === "figcaption" || /\bcaption\d*\b/.test($(element).attr("class") ?? ""),
      ).length;
    $("img[src], image, svg *").each((_, element) => {
      const reference = $(element).attr("src") ?? $(element).attr("xlink:href") ?? $(element).attr("href") ?? "";
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) counts.externalReferences++;
    });
  }
  return counts;
}

/** With `options.codec` the EPUB is parsed as an import parses it, images normalized; the fingerprint is the same. */
export async function fingerprintEpub(buffer: Buffer, options: ParseOptions = {}): Promise<EpubFingerprint> {
  const epub = await parseEpub(buffer, {}, options);

  return {
    fileSha256: sha256(buffer),
    bytes: buffer.length,
    title: epub.title,
    language: epub.language,
    chapters: epub.chapters.map((chapter) => ({
      number: chapter.number,
      slug: chapter.slug,
      title: chapter.title,
      wordCount: chapter.wordCount,
      contentSha256: sha256(chapter.content),
      paragraphs: chapter.content
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean).length,
      blocksSha256: sha256(JSON.stringify(chapter.blocks)),
      figures: chapter.blocks.blocks.filter((block) => block.type === "figure").length,
      figuresWithImage: chapter.blocks.blocks.filter((block) => block.type === "figure" && block.image).length,
    })),
    totalWords: epub.extraction.totalWords,
    keptWords: epub.extraction.keptWords,
    discardedWords: epub.extraction.discardedWords,
    leadingWords: epub.extraction.leadingWords,
    warnings: epub.extraction.warnings.length,
    cover: epub.cover
      ? { mediaType: epub.cover.mediaType, bytes: epub.cover.data.length, sha256: sha256(epub.cover.data) }
      : null,
    markup: await inventory(buffer),
    images: epub.extraction.images,
  };
}
