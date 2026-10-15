import path from "node:path";

import { XMLParser, XMLValidator } from "fast-xml-parser";
import JSZip from "jszip";

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
  content: string;
  wordCount: number;
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
}

export const defaultEpubLimits: EpubLimits = {
  maxFileBytes: 200 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 600 * 1024 * 1024,
  maxEntries: 20_000,
  maxCoverBytes: 10 * 1024 * 1024,
};

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

export async function parseEpub(buffer: Buffer, overrides: Partial<EpubLimits> = {}): Promise<ParsedEpub> {
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

  const { sections: rawSections, report: extraction } = extractEpubSectionsWithReport(documents, navigation, title);

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

    return {
      number: index + 1,
      slug,
      title: section.title,
      content: section.content,
      wordCount: countWords(section.content),
    };
  });

  extraction.warnings.push(...coverWarnings);

  return {
    title,
    creators: creators.map(getXmlText).filter(Boolean),
    translator: translators.length > 0 ? translators.join(", ") : null,
    language,
    cover,
    chapters,
    extraction,
  };
}
