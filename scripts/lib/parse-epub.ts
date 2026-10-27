import path from "node:path";

import { XMLParser, XMLValidator } from "fast-xml-parser";
import JSZip from "jszip";

import {
  CHAPTER_BLOCKS_VERSION,
  deriveChapterContent,
  parseChapterBlocks,
  type ChapterBlocks,
} from "../../src/lib/chapter-blocks";
import {
  EditionImageBudget,
  IMAGE_LIMITS,
  inspectImage,
  processImage,
  type ImageCodec,
  type ImageInspection,
  type ImageIssue,
  type ImageIssueCode,
  type ImageLimits,
  type ProcessedImage,
} from "./epub-images";
import {
  extractEpubSectionsWithReport,
  type EpubDocument,
  type EpubNavigation,
  type ExtractionReport,
} from "./epub-sections";

export interface ParsedChapter {
  number: number;
  slug: string;
  title: string;
  /** Plain text derived from `blocks`: one paragraph per text block. The importer stores it together with `blocks`. */
  content: string;
  wordCount: number;
  /** Typed editorial blocks, validated; figures reference images by their archive path. */
  blocks: ChapterBlocks;
}

export interface ParsedEpub {
  title: string;
  creators: string[];
  translator: string | null;
  language: string;
  cover: ParsedCover | null;
  chapters: ParsedChapter[];
  /** What the section extractor kept and discarded; review `warnings` before importing. */
  extraction: ExtractionReport;
  /**
   * The normalized image of every figure whose `image` is not null, one per archive path, sorted by path; null when
   * the EPUB was parsed without a codec (then figure images are inspected but not normalized).
   */
  images: NormalizedImage[] | null;
  /** Figures left without an image (inspection, normalization or reference failed), in reading order. */
  imageWarnings: ImageWarning[];
}

/** An image normalized by the codec, ready to be stored: nothing is uploaded or written by the parser. */
export type NormalizedImage = Omit<Extract<ProcessedImage, { status: "ready" }>, "status"> & {
  /** The width limit it was normalized under (IMAGE_LIMITS.maxNormalizedWidth): part of its identity. */
  maxWidth: number;
};

export interface ImageWarning {
  /** Number of the chapter holding the figure, and its title. */
  chapter: number;
  chapterTitle: string;
  /** The reference as written in the XHTML, and the archive path it resolves to (null outside the archive). */
  reference: string;
  sourcePath: string | null;
  code: ImageIssueCode;
  reason: string;
}

export interface ParseOptions {
  /**
   * Normalizes every figure image with this codec; an image it rejects leaves its figure without an image. Imports
   * pass a codec verified by createVerifiedSharpCodec.
   */
  codec?: ImageCodec;
}

export interface ParsedCover {
  data: Buffer;
  mediaType: string;
  extension: string;
}

interface ManifestItem {
  "@_id"?: string;
  "@_href"?: string;
  "@_media-type"?: string;
  "@_properties"?: string;
}

interface SpineItem {
  "@_idref"?: string;
}

interface Spine {
  "@_toc"?: string;
  itemref?: SpineItem | SpineItem[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];

  return Array.isArray(value) ? value : [value];
}

function getXmlText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object" && "#text" in value) {
    const text = (
      value as {
        "#text": unknown;
      }
    )["#text"];

    return String(text).trim();
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAttribute(value: unknown, name: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const attribute = Reflect.get(value, `@_${name}`);

  return typeof attribute === "string" ? attribute.trim() : undefined;
}

function isTranslatorRole(value: string | undefined) {
  const role = value?.toLowerCase();

  return role === "trl" || role === "translator" || role === "translation";
}

function getTranslatorIds(metadata: Record<string, unknown>): Set<string> {
  const translatorIds = new Set<string>();
  const metadataItems = asArray(metadata.meta).filter(isRecord);

  for (const item of metadataItems) {
    if (getAttribute(item, "property") !== "role" || !isTranslatorRole(getXmlText(item))) {
      continue;
    }

    const reference = getAttribute(item, "refines");

    if (reference?.startsWith("#")) {
      translatorIds.add(reference.slice(1));
    }
  }

  return translatorIds;
}

function isTranslator(value: unknown, translatorIds: Set<string>) {
  const id = getAttribute(value, "id");

  return (
    isTranslatorRole(getAttribute(value, "role")) ||
    isTranslatorRole(getAttribute(value, "opf:role")) ||
    (id !== undefined && translatorIds.has(id))
  );
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function countWords(value: string) {
  const clean = value.trim();

  if (!clean) return 0;

  return clean.split(/\s+/).length;
}

function resolveEpubPath(opfPath: string, href: string) {
  const cleanHref = decodeURIComponent(href.split("#")[0].split("?")[0]);

  return path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), cleanHref));
}

function validateXml(xml: string, resource: string) {
  const result = XMLValidator.validate(xml);
  if (result !== true) {
    throw new Error(`EPUB validation failed: invalid XML in ${resource}: ${result.err.msg} (line ${result.err.line})`);
  }
}

function resolveSpinePath(opfPath: string, href: string, idref: string) {
  try {
    const file = decodeURIComponent(href.split("#")[0].split("?")[0]);
    const resolved = resolveEpubPath(opfPath, href);
    if (
      !file.trim() ||
      /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(file) ||
      file.includes("\\") ||
      file.includes("\0") ||
      resolved === ".." ||
      resolved.startsWith("../")
    ) {
      throw new Error("Expected a local ZIP resource");
    }
    return resolved;
  } catch (cause) {
    throw new Error(`EPUB validation failed: invalid spine reference: ${idref} -> ${href}`, { cause });
  }
}

export interface EpubLimits {
  /** Size of the EPUB file itself. */
  maxFileBytes: number;
  /** Uncompressed size of any single ZIP entry. */
  maxEntryBytes: number;
  /** Uncompressed size of all entries together. */
  maxTotalBytes: number;
  maxEntries: number;
  maxCoverBytes: number;
  /** Illustrations: per file, per edition, dimensions (see epub-images.ts). */
  images: ImageLimits;
}

export const defaultEpubLimits: EpubLimits = {
  maxFileBytes: 200 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 600 * 1024 * 1024,
  maxEntries: 20_000,
  maxCoverBytes: 10 * 1024 * 1024,
  images: IMAGE_LIMITS,
};

type ManifestImage = { inspection: ImageInspection } | { issue: ImageIssue };

/**
 * What each image the manifest declares is, by inspectImage (format by bytes, structure, dimensions, size; nothing
 * decoded): the archive path, checked to stay inside the archive, with its inspection or the issue that rules it out.
 */
async function manifestImages(
  zip: JSZip,
  opfPath: string,
  items: ManifestItem[],
  limits: ImageLimits,
): Promise<Map<string, ManifestImage>> {
  const images = new Map<string, ManifestImage>();

  for (const item of items) {
    const href = item["@_href"];
    if (!href || !item["@_media-type"]?.startsWith("image/")) continue;

    let imagePath: string;
    try {
      imagePath = resolveEpubPath(opfPath, href);
    } catch {
      continue;
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href) || imagePath === ".." || imagePath.startsWith("../")) continue;

    const file = zip.file(imagePath);
    if (!file) {
      images.set(imagePath, {
        issue: { code: "missing", message: "declared in the manifest but missing from the archive" },
      });
      continue;
    }
    // The declared size is checked before inflating the entry.
    if (declaredSize(file) > limits.maxFileBytes) {
      images.set(imagePath, {
        issue: { code: "file-too-large", message: `${declaredSize(file)} bytes exceeds ${limits.maxFileBytes}` },
      });
      continue;
    }
    const result = await inspectImage(await file.async("nodebuffer"), limits);
    images.set(imagePath, result.ok ? { inspection: result.inspection } : { issue: result.issue });
  }
  return images;
}

// JSZip records the size declared in the central directory; reading it avoids inflating a zip bomb first.
function declaredSize(file: JSZip.JSZipObject) {
  const size = (file as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;

  return typeof size === "number" ? size : 0;
}

function assertZipWithinLimits(zip: JSZip, limits: EpubLimits) {
  const files = Object.values(zip.files).filter((file) => !file.dir);
  let total = 0;

  if (files.length > limits.maxEntries) {
    throw new Error(`EPUB validation failed: ${files.length} ZIP entries exceed the limit of ${limits.maxEntries}`);
  }

  for (const file of files) {
    const size = declaredSize(file);
    total += size;

    if (size > limits.maxEntryBytes) {
      throw new Error(
        `EPUB validation failed: ZIP entry ${file.name} expands to ${size} bytes (limit ${limits.maxEntryBytes})`,
      );
    }
  }

  if (total > limits.maxTotalBytes) {
    throw new Error(`EPUB validation failed: the archive expands to ${total} bytes (limit ${limits.maxTotalBytes})`);
  }
}

/** Recognizes the raster formats the site can serve by their magic bytes, never by the declared media type. */
export function detectCoverImage(data: Buffer): { mediaType: string; extension: string } | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mediaType: "image/jpeg", extension: "jpg" };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mediaType: "image/png", extension: "png" };
  }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { mediaType: "image/webp", extension: "webp" };
  }

  return null;
}

/** Code-point order, the same everywhere (localeCompare depends on the ICU data of the runtime). */
export const compareText = (first: string, second: string) => (first < second ? -1 : first > second ? 1 : 0);

export async function parseEpub(
  buffer: Buffer,
  overrides: Partial<EpubLimits> = {},
  options: ParseOptions = {},
): Promise<ParsedEpub> {
  const limits = { ...defaultEpubLimits, ...overrides };

  if (buffer.length > limits.maxFileBytes) {
    throw new Error(`EPUB validation failed: the file is ${buffer.length} bytes (limit ${limits.maxFileBytes})`);
  }

  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  assertZipWithinLimits(zip, limits);

  const containerFile = zip.file("META-INF/container.xml");

  if (!containerFile) {
    throw new Error("Invalid EPUB: META-INF/container.xml not found");
  }

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
  });

  const containerXml = await containerFile.async("string");
  validateXml(containerXml, "META-INF/container.xml");
  const container = xmlParser.parse(containerXml);

  const rootFiles = asArray(container?.container?.rootfiles?.rootfile);
  const opfPath = rootFiles[0]?.["@_full-path"];

  if (!opfPath) {
    throw new Error("Invalid EPUB: OPF package not found");
  }

  const opfFile = zip.file(opfPath);

  if (!opfFile) {
    throw new Error(`Invalid EPUB: ${opfPath} not found`);
  }

  const opfXml = await opfFile.async("string");
  validateXml(opfXml, opfPath);
  const opf = xmlParser.parse(opfXml);
  const pkg = opf?.package;

  if (!pkg) {
    throw new Error("Invalid EPUB: package metadata not found");
  }

  const metadata = pkg.metadata ?? {};

  const title = getXmlText(metadata.title);

  if (!title) {
    throw new Error("Invalid EPUB: a single non-empty dc:title is required; no title will be invented.");
  }

  const translatorIds = getTranslatorIds(metadata);
  const creators = asArray(metadata.creator).filter((creator) => !isTranslator(creator, translatorIds));
  const translators = [
    ...asArray(metadata.creator).filter((creator) => isTranslator(creator, translatorIds)),
    ...asArray(metadata.contributor).filter((contributor) => isTranslator(contributor, translatorIds)),
  ]
    .map(getXmlText)
    .filter(Boolean);

  const language = getXmlText(metadata.language).toLowerCase();

  if (!language || language.length > 10) {
    throw new Error(
      "Invalid EPUB: a single non-empty dc:language of at most 10 characters is required; no language will be inferred or truncated.",
    );
  }

  const manifestItems = asArray<ManifestItem>(pkg.manifest?.item);

  const spine = (pkg.spine ?? {}) as Spine;
  const spineItems = asArray<SpineItem>(spine.itemref);

  const manifest = new Map<string, ManifestItem>();

  for (const item of manifestItems) {
    if (item["@_id"]) {
      if (manifest.has(item["@_id"])) {
        throw new Error(`EPUB validation failed: duplicate manifest id: ${item["@_id"]}`);
      }
      manifest.set(item["@_id"], item);
    }
  }

  /*
   * Cover
   */

  let coverItem = manifestItems.find((item) => item["@_properties"]?.split(/\s+/).includes("cover-image"));

  if (!coverItem) {
    const metadataItems = asArray<{
      "@_name"?: string;
      "@_content"?: string;
    }>(metadata.meta);

    const coverMetadata = metadataItems.find((item) => item["@_name"] === "cover");

    const coverId = coverMetadata?.["@_content"];

    if (coverId) {
      coverItem = manifest.get(coverId);
    }
  }

  let cover: ParsedCover | null = null;
  const coverWarnings: string[] = [];

  if (coverItem?.["@_href"]) {
    const coverPath = resolveEpubPath(opfPath, coverItem["@_href"]);

    const coverFile = zip.file(coverPath);

    if (coverFile) {
      const data = await coverFile.async("nodebuffer");
      const image = detectCoverImage(data);

      if (data.length > limits.maxCoverBytes) {
        coverWarnings.push(`Cover ignored: ${coverPath} is ${data.length} bytes (limit ${limits.maxCoverBytes}).`);
      } else if (!image) {
        coverWarnings.push(
          `Cover ignored: ${coverPath} is not a JPEG, PNG or WebP image (declared ${coverItem["@_media-type"] ?? "no media type"}).`,
        );
      } else {
        // The detected format wins over whatever the manifest declares.
        cover = { data, ...image };
      }
    }
  }

  /*
   * Reading documents in spine order
   */

  const documents: EpubDocument[] = [];

  for (const [index, spineItem] of spineItems.entries()) {
    const idref = spineItem["@_idref"];

    if (!idref?.trim()) {
      throw new Error(`EPUB validation failed: spine item ${index + 1} has no idref`);
    }

    const item = manifest.get(idref);

    if (!item) {
      throw new Error(`EPUB validation failed: spine manifest item not found: ${idref}`);
    }

    const mediaType = item["@_media-type"];
    const properties = item["@_properties"] ?? "";

    /*
     * EPUB3 nav documents are navigation metadata, not reading
     * documents even if the package also places them in the spine.
     */
    if (properties.split(/\s+/).includes("nav")) {
      continue;
    }

    if (!mediaType) {
      throw new Error(`EPUB validation failed: spine manifest item has no media-type: ${idref}`);
    }

    if (mediaType !== "application/xhtml+xml" && mediaType !== "text/html") {
      continue;
    }

    const href = item["@_href"];
    if (!href?.trim()) {
      throw new Error(`EPUB validation failed: spine manifest item has no href: ${idref}`);
    }
    const filePath = resolveSpinePath(opfPath, href, idref);

    const contentFile = zip.file(filePath);

    if (!contentFile) {
      throw new Error(`EPUB validation failed: spine document not found: ${filePath} (idref: ${idref})`);
    }

    let html: string;
    try {
      html = await contentFile.async("string");
    } catch (cause) {
      throw new Error(`EPUB validation failed: cannot read spine document: ${filePath}`, { cause });
    }
    if (!html.trim()) {
      throw new Error(`EPUB validation failed: empty spine document: ${filePath}`);
    }
    if (mediaType === "application/xhtml+xml") validateXml(html, filePath);

    documents.push({
      path: filePath,
      html,
      xhtml: mediaType === "application/xhtml+xml",
    });
  }

  /*
   * EPUB navigation sources.
   *
   * Prefer EPUB3 nav. extractEpubSections() itself gives nav
   * precedence over NCX if both are available.
   */

  const navigation: EpubNavigation[] = [];

  const navItems = manifestItems.filter((item) => item["@_properties"]?.split(/\s+/).includes("nav"));

  for (const navItem of navItems) {
    if (!navItem["@_href"]) continue;

    const navPath = resolveEpubPath(opfPath, navItem["@_href"]);

    const navFile = zip.file(navPath);

    if (!navFile) continue;

    navigation.push({
      path: navPath,
      content: await navFile.async("string"),
      kind: "nav",
    });
  }

  /*
   * EPUB2 NCX.
   *
   * First use spine@toc when present. Some EPUBs do not provide
   * that correctly, so media type is used as a fallback.
   */

  const ncxItems: ManifestItem[] = [];

  if (spine["@_toc"]) {
    const ncxFromSpine = manifest.get(spine["@_toc"]);

    if (ncxFromSpine) {
      ncxItems.push(ncxFromSpine);
    }
  }

  for (const item of manifestItems) {
    if (item["@_media-type"] === "application/x-dtbncx+xml" && !ncxItems.includes(item)) {
      ncxItems.push(item);
    }
  }

  for (const ncxItem of ncxItems) {
    if (!ncxItem["@_href"]) continue;

    const ncxPath = resolveEpubPath(opfPath, ncxItem["@_href"]);

    const ncxFile = zip.file(ncxPath);

    if (!ncxFile) continue;

    navigation.push({
      path: ncxPath,
      content: await ncxFile.async("string"),
      kind: "ncx",
    });
  }

  /*
   * Structural chapter extraction.
   */

  const images = await manifestImages(zip, opfPath, manifestItems, limits.images);

  /*
   * With a codec, every image a figure resolves to is normalized, and one the codec rejects is unavailable like one
   * inspection rejects. Extraction runs again until every admitted image is normalized: a rejected image frees its
   * place in the per-edition budget, which may admit a later one, normalized in the next pass. Each pass normalizes
   * at least one new image, so the loop ends. Identical bytes under several paths are normalized once.
   */
  const { codec } = options;
  const normalized = new Map<string, ProcessedImage>();
  const bySource = new Map<string, ProcessedImage>();

  async function normalize(with_: ImageCodec, imagePath: string, inspection: ImageInspection): Promise<ProcessedImage> {
    const known = bySource.get(inspection.sourceSha256);
    if (known) return { ...known, sourcePath: imagePath };
    const file = zip.file(imagePath);
    const result: ProcessedImage = file
      ? await processImage(imagePath, await file.async("nodebuffer"), with_, limits.images)
      : { status: "rejected", sourcePath: imagePath, issue: { code: "missing", message: "missing from the archive" } };
    bySource.set(inspection.sourceSha256, result);
    return result;
  }

  let extracted: ReturnType<typeof extractEpubSectionsWithReport>;
  for (;;) {
    // Figures resolve in reading order, so the per-edition limits refuse the images past them, never earlier ones.
    const budget = new EditionImageBudget(limits.images);
    const admitted = new Set<string>();
    extracted = extractEpubSectionsWithReport(documents, navigation, title, {
      resolveImage: (imagePath) => {
        const image = images.get(imagePath);
        if (!image) {
          return {
            unavailable: zip.file(imagePath)
              ? { code: "undeclared", message: "not declared as an image in the manifest" }
              : { code: "missing", message: "missing from the archive" },
          };
        }
        if ("issue" in image) return { unavailable: image.issue };
        const result = normalized.get(imagePath);
        if (result?.status === "rejected") return { unavailable: result.issue };
        const refused = budget.admit(imagePath, image.inspection.bytes);
        if (refused) return { unavailable: refused };
        admitted.add(imagePath);
        return { path: imagePath, mediaType: image.inspection.mediaType };
      },
    });
    if (!codec) break;

    const pending = [...admitted].filter((imagePath) => !normalized.has(imagePath));
    if (!pending.length) break;
    for (const imagePath of pending) {
      const image = images.get(imagePath);
      if (!image || "issue" in image) throw new Error(`EPUB image ${imagePath} was admitted without an inspection`);
      normalized.set(imagePath, await normalize(codec, imagePath, image.inspection));
    }
    if (pending.every((imagePath) => normalized.get(imagePath)?.status === "ready")) break;
  }
  const { sections: rawSections, report: extraction } = extracted;

  if (rawSections.length === 0) {
    throw new Error("No readable chapters were detected in the EPUB");
  }

  /*
   * Stable chapter slugs.
   *
   * Do not deduplicate sections merely because their titles match.
   * Repeated legitimate titles receive deterministic slug suffixes.
   */

  const usedSlugs = new Set<string>();

  const chapters = rawSections.map((section, index) => {
    const baseSlug = slugify(section.title) || `chapter-${index + 1}`;

    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
    usedSlugs.add(slug);

    // Validated like stored blocks will be: an extraction can never produce a shape the schema does not allow.
    const blocks = parseChapterBlocks({ version: CHAPTER_BLOCKS_VERSION, blocks: section.blocks });
    const content = deriveChapterContent(blocks.blocks);

    return {
      number: index + 1,
      slug,
      title: section.title,
      content,
      wordCount: countWords(content),
      blocks,
    };
  });

  extraction.warnings.push(...coverWarnings);

  // Every figure with an image has its normalized image: the blocks never reference one that does not exist.
  let figureImages: NormalizedImage[] | null = null;
  if (codec) {
    const byPath = new Map<string, NormalizedImage>();
    for (const chapter of chapters) {
      for (const block of chapter.blocks.blocks) {
        if (block.type !== "figure" || !block.image || byPath.has(block.image.path)) continue;
        const result = normalized.get(block.image.path);
        if (result?.status !== "ready" || result.mediaType !== block.image.mediaType) {
          throw new Error(`EPUB extraction failed: figure image ${block.image.path} has no normalized image`);
        }
        byPath.set(block.image.path, {
          sourcePath: result.sourcePath,
          sourceSha256: result.sourceSha256,
          sha256: result.sha256,
          key: result.key,
          mediaType: result.mediaType,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          codec: result.codec,
          data: result.data,
          maxWidth: limits.images.maxNormalizedWidth,
        });
      }
    }
    figureImages = [...byPath.values()].sort((first, second) => compareText(first.sourcePath, second.sourcePath));
  }

  const imageWarnings: ImageWarning[] = extraction.images.unavailable.map((item) => {
    const chapter = chapters[item.section];
    if (!chapter) throw new Error(`EPUB extraction failed: unavailable image ${item.reference} has no chapter`);
    return {
      chapter: chapter.number,
      chapterTitle: chapter.title,
      reference: item.reference,
      sourcePath: item.path,
      code: item.code,
      reason: item.reason,
    };
  });

  return {
    title,
    creators: creators.map(getXmlText).filter(Boolean),
    translator: translators.length > 0 ? translators.join(", ") : null,
    language,
    cover,
    chapters,
    extraction,
    images: figureImages,
    imageWarnings,
  };
}
