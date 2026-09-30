import path from "node:path";

import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

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
  language: string;
  cover: ParsedCover | null;
  chapters: ParsedChapter[];
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

function cleanText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function shouldIgnoreSection(title: string) {
  const normalized = title.toLowerCase();

  const ignored = [
    "contents",
    "table of contents",
    "copyright",
    "project gutenberg license",
    "the project gutenberg",
    "transcriber",
    "credits",
    "illustrations",
    "title page",
  ];

  return ignored.some((value) => normalized.includes(value));
}

function resolveEpubPath(opfPath: string, href: string) {
  const cleanHref = decodeURIComponent(href.split("#")[0]);

  return path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), cleanHref));
}

function parseHtmlSections(html: string) {
  const $ = load(html);

  $("script, style, nav, svg").remove();

  const sections: {
    title: string;
    paragraphs: string[];
  }[] = [];

  let currentTitle = "";
  let paragraphs: string[] = [];

  function flush() {
    if (!currentTitle) {
      paragraphs = [];
      return;
    }

    const content = paragraphs.join("\n\n");
    const wordCount = countWords(content);

    if (wordCount >= 50 && !shouldIgnoreSection(currentTitle)) {
      sections.push({
        title: currentTitle,
        paragraphs: [...paragraphs],
      });
    }

    currentTitle = "";
    paragraphs = [];
  }

  $("body")
    .find("h1, h2, h3, p")
    .each((_, element) => {
      const tagName = element.tagName.toLowerCase();

      const text = cleanText($(element).text());

      if (!text) return;

      if (tagName === "h1" || tagName === "h2" || tagName === "h3") {
        flush();
        currentTitle = text;
        return;
      }

      if (currentTitle) {
        paragraphs.push(text);
      }
    });

  flush();

  return sections;
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

  const creators = asArray(metadata.creator).map(getXmlText).filter(Boolean);

  const language = getXmlText(metadata.language).toLowerCase().slice(0, 10) || "en";

  const manifestItems = asArray<ManifestItem>(pkg.manifest?.item);

  const spineItems = asArray<SpineItem>(pkg.spine?.itemref);

  const manifest = new Map<string, ManifestItem>();

  for (const item of manifestItems) {
    if (item["@_id"]) {
      manifest.set(item["@_id"], item);
    }
  }

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

  const rawSections: {
    title: string;
    content: string;
  }[] = [];

  for (const spineItem of spineItems) {
    const idref = spineItem["@_idref"];

    if (!idref) continue;

    const item = manifest.get(idref);

    if (!item) continue;

    const href = item["@_href"];
    const mediaType = item["@_media-type"];
    const properties = item["@_properties"] ?? "";

    if (!href) continue;

    if (properties.includes("nav")) {
      continue;
    }

    if (mediaType !== "application/xhtml+xml" && mediaType !== "text/html") {
      continue;
    }

    const filePath = resolveEpubPath(opfPath, href);

    const contentFile = zip.file(filePath);

    if (!contentFile) continue;

    const html = await contentFile.async("string");

    const sections = parseHtmlSections(html);

    for (const section of sections) {
      rawSections.push({
        title: section.title,
        content: section.paragraphs.join("\n\n"),
      });
    }
  }

  if (rawSections.length === 0) {
    throw new Error("No readable chapters were detected in the EPUB");
  }

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
    creators,
    language,
    cover,
    chapters,
  };
}

export interface ParsedCover {
  data: Buffer;
  mediaType: string;
  extension: string;
}
