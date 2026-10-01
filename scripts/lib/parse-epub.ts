import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import { extractEpubSections, type EpubDocument, type EpubNavigation } from "./epub-sections";

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

export async function parseEpub(buffer: Buffer): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buffer);

  const containerFile = zip.file("META-INF/container.xml");

  if (!containerFile) {
    throw new Error("Invalid EPUB: META-INF/container.xml not found");
  }

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    trimValues: true,
  });

  const containerXml = await containerFile.async("string");
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
  const opf = xmlParser.parse(opfXml);
  const pkg = opf?.package;

  if (!pkg) {
    throw new Error("Invalid EPUB: package metadata not found");
  }

  const metadata = pkg.metadata ?? {};

  const title = getXmlText(metadata.title) || "Untitled";

  const translatorIds = getTranslatorIds(metadata);
  const creators = asArray(metadata.creator).filter((creator) => !isTranslator(creator, translatorIds));
  const translators = [
    ...asArray(metadata.creator).filter((creator) => isTranslator(creator, translatorIds)),
    ...asArray(metadata.contributor).filter((contributor) => isTranslator(contributor, translatorIds)),
  ]
    .map(getXmlText)
    .filter(Boolean);

  const language = getXmlText(metadata.language).toLowerCase().slice(0, 10) || "en";

  const manifestItems = asArray<ManifestItem>(pkg.manifest?.item);

  const spine = (pkg.spine ?? {}) as Spine;
  const spineItems = asArray<SpineItem>(spine.itemref);

  const manifest = new Map<string, ManifestItem>();

  for (const item of manifestItems) {
    if (item["@_id"]) {
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

  if (coverItem?.["@_href"]) {
    const coverPath = resolveEpubPath(opfPath, coverItem["@_href"]);

    const coverFile = zip.file(coverPath);

    if (coverFile) {
      const mediaType = coverItem["@_media-type"] ?? "image/jpeg";

      const extension = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";

      cover = {
        data: await coverFile.async("nodebuffer"),
        mediaType,
        extension,
      };
    }
  }

  /*
   * Reading documents in spine order
   */

  const documents: EpubDocument[] = [];

  for (const spineItem of spineItems) {
    const idref = spineItem["@_idref"];

    if (!idref) continue;

    const item = manifest.get(idref);

    if (!item?.["@_href"]) continue;

    const mediaType = item["@_media-type"];
    const properties = item["@_properties"] ?? "";

    /*
     * EPUB3 nav documents are navigation metadata, not reading
     * documents even if the package also places them in the spine.
     */
    if (properties.split(/\s+/).includes("nav")) {
      continue;
    }

    if (mediaType !== "application/xhtml+xml" && mediaType !== "text/html") {
      continue;
    }

    const filePath = resolveEpubPath(opfPath, item["@_href"]);

    const contentFile = zip.file(filePath);

    if (!contentFile) continue;

    documents.push({
      path: filePath,
      html: await contentFile.async("string"),
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

  const rawSections = extractEpubSections(documents, navigation, title);

  if (rawSections.length === 0) {
    throw new Error("No readable chapters were detected in the EPUB");
  }

  /*
   * Stable chapter slugs.
   *
   * Do not deduplicate sections merely because their titles match.
   * Repeated legitimate titles receive deterministic slug suffixes.
   */

  const slugUsage = new Map<string, number>();

  const chapters = rawSections.map((section, index) => {
    const baseSlug = slugify(section.title) || `chapter-${index + 1}`;

    const usage = slugUsage.get(baseSlug) ?? 0;

    slugUsage.set(baseSlug, usage + 1);

    const slug = usage === 0 ? baseSlug : `${baseSlug}-${usage + 1}`;

    return {
      number: index + 1,
      slug,
      title: section.title,
      content: section.content,
      wordCount: countWords(section.content),
    };
  });

  return {
    title,
    creators: creators.map(getXmlText).filter(Boolean),
    translator: translators.length > 0 ? translators.join(", ") : null,
    language,
    cover,
    chapters,
  };
}
