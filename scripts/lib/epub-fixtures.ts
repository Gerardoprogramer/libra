import JSZip from "jszip";

// Small EPUB 3 packages built in memory for the parser tests: the markup follows what Project Gutenberg's
// ebookmaker writes (figures as div.figcenter with a div.caption, decorative images in chapter headings, drop
// capitals as an image whose alt is the missing letter), so the tests exercise the same shapes as the catalogue
// without reading imports/ or touching PostgreSQL or R2.

/** A valid 1×1 PNG: decodable, so later image processing can be tested with the same fixtures. */
export const pngPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** PNG signature followed by nothing: recognized by its magic bytes but not decodable. */
export const truncatedPng = pngPixel.subarray(0, 12);

export interface FixtureDocument {
  /** Path inside OEBPS/, as the manifest refers to it. */
  href: string;
  body: string;
}

export interface FixtureResource {
  /** Path inside OEBPS/. */
  href: string;
  mediaType: string;
  data: Buffer;
  properties?: string;
}

export interface FixtureEpub {
  title: string;
  language?: string;
  creator?: string;
  documents: FixtureDocument[];
  resources?: FixtureResource[];
  /** Table of contents entries as [href, label]; hrefs are relative to OEBPS/nav.xhtml. */
  toc?: [href: string, label: string][];
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function xhtml(title: string, body: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escape(title)}</title></head>
<body>${body}</body>
</html>`;
}

export async function buildEpub3({
  title,
  language = "en",
  creator = "Fixture Author",
  documents,
  resources = [],
  toc,
}: FixtureEpub): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const items = documents.map(
    (document, index) =>
      `<item id="doc${index + 1}" href="${escape(document.href)}" media-type="application/xhtml+xml"/>`,
  );
  const resourceItems = resources.map(
    (resource, index) =>
      `<item id="res${index + 1}" href="${escape(resource.href)}" media-type="${escape(resource.mediaType)}"${
        resource.properties ? ` properties="${escape(resource.properties)}"` : ""
      }/>`,
  );
  const navItem = toc ? [`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`] : [];

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:libra:fixture</dc:identifier>
    <dc:title>${escape(title)}</dc:title>
    <dc:language>${escape(language)}</dc:language>
    <dc:creator>${escape(creator)}</dc:creator>
  </metadata>
  <manifest>${[...navItem, ...items, ...resourceItems].join("")}</manifest>
  <spine>${documents.map((_, index) => `<itemref idref="doc${index + 1}"/>`).join("")}</spine>
</package>`,
  );

  if (toc) {
    zip.file(
      "OEBPS/nav.xhtml",
      xhtml(
        "Contents",
        `<nav epub:type="toc" id="toc"><ol>${toc
          .map(([href, label]) => `<li><a href="${escape(href)}">${escape(label)}</a></li>`)
          .join("")}</ol></nav>`,
      ),
    );
  }

  for (const document of documents) zip.file(`OEBPS/${document.href}`, xhtml(title, document.body));
  for (const resource of resources) zip.file(`OEBPS/${resource.href}`, resource.data);

  return zip.generateAsync({ type: "nodebuffer" });
}

const sentence = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label} sentence ${index + 1} keeps the reader company.`).join(" ");

/** The reading situations Phase 1 must keep or improve, each as a complete EPUB 3. */
export const epubFixtures = {
  /** One chapter of plain paragraphs: no images, no inline markup. */
  plainText: () =>
    buildEpub3({
      title: "Plain Fixture",
      documents: [
        {
          href: "chapter-1.xhtml",
          body: `<h2>Chapter I</h2><p>${sentence("First", 4)}</p><p>${sentence("Second", 3)}</p>`,
        },
      ],
      toc: [["chapter-1.xhtml", "Chapter I"]],
    }),

  /** Subheadings, emphasis, an unordered and an ordered list, a quotation and verse lines separated by <br/>. */
  structure: () =>
    buildEpub3({
      title: "Structure Fixture",
      documents: [
        {
          href: "chapter-1.xhtml",
          body: `<h2>Chapter I</h2>
<p>The opening paragraph has <em>emphasis</em>, <i>italics</i> and <strong>strong</strong> words in it.</p>
<h3>A Subheading</h3>
<p>${sentence("Middle", 2)}</p>
<ul><li>First item of the list.</li><li>Second item of the list.</li></ul>
<ol><li>One ordered step.</li><li>Two ordered steps.</li></ol>
<blockquote><p>A quoted passage stands apart.</p></blockquote>
<div class="poem"><p>The first line of verse,<br/>the second line of verse,<br/>the third line of verse.</p></div>
<p>${sentence("Closing", 2)}</p>`,
        },
      ],
      toc: [["chapter-1.xhtml", "Chapter I"]],
    }),

  /** A captioned illustration twice: as an HTML5 figure and in Gutenberg's div.figcenter + div.caption form. */
  figureWithCaption: () =>
    buildEpub3({
      title: "Figure Fixture",
      documents: [
        {
          href: "text/chapter-1.xhtml",
          body: `<h2>Chapter I</h2>
<p>${sentence("Before", 2)}</p>
<figure><img src="../images/plate-1.png" alt="A ship at anchor"/><figcaption>“The ship lay at anchor.”</figcaption></figure>
<p>${sentence("Between", 2)}</p>
<div class="figcenter" role="figure" aria-labelledby="caption-2"><img src="../images/plate-2.png" alt=""/><div class="caption" id="caption-2"><p>“they entered the breakfast room”</p></div></div>
<p>${sentence("After", 2)}</p>`,
        },
      ],
      resources: [
        { href: "images/plate-1.png", mediaType: "image/png", data: pngPixel },
        { href: "images/plate-2.png", mediaType: "image/png", data: pngPixel },
      ],
      toc: [["text/chapter-1.xhtml", "Chapter I"]],
    }),

  /** A decorative image inside the chapter heading, before the heading text, as in the illustrated Pride and Prejudice. */
  decorativeHeadingImage: () =>
    buildEpub3({
      title: "Heading Image Fixture",
      documents: [
        {
          href: "chapter-21.xhtml",
          body: `<h2><img src="heading-21.png" alt=""/><br/><br/>CHAPTER XXI.</h2><p>${sentence("Heading", 3)}</p>`,
        },
      ],
      resources: [{ href: "heading-21.png", mediaType: "image/png", data: pngPixel }],
      toc: [["chapter-21.xhtml", "CHAPTER XXI."]],
    }),

  /** A drop capital drawn as an image: its alt is the only place the first letter of the paragraph exists. */
  dropCap: () =>
    buildEpub3({
      title: "Drop Cap Fixture",
      documents: [
        {
          href: "chapter-21.xhtml",
          body: `<h2>CHAPTER XXI.</h2>
<p class="nind"><span class="letra"><img src="letter-t.png" alt="T"/></span>HE discussion of the offer was now nearly at an end. ${sentence("Drop", 2)}</p>
<p>${sentence("Next", 2)}</p>`,
        },
      ],
      resources: [{ href: "letter-t.png", mediaType: "image/png", data: pngPixel }],
      toc: [["chapter-21.xhtml", "CHAPTER XXI."]],
    }),

  /**
   * Three chapters across two spine documents: the first without images; the second with an ebookmaker page number and
   * an illustration in the Wizard of Oz form (div.figcenter with role="figure", an alt that repeats the caption and a
   * p.caption2 caption that the current extractor does not recognize); the third with a missing and a damaged image.
   */
  mixedChapters: () =>
    buildEpub3({
      title: "Mixed Fixture",
      documents: [
        { href: "part-1.xhtml", body: `<h2 id="c1">Chapter I</h2><p>${sentence("Plain", 3)}</p>` },
        {
          href: "part-2.xhtml",
          body: `<h2 id="c2">Chapter II</h2>
<p>${sentence("Illustrated", 2)}</p>
<p><span class="x-ebookmaker-pageno" title="[Pg 12]"><a id="Page_12" title="[Pg 12]"></a></span></p>
<div class="figcenter" role="figure" aria-labelledby="caption-toto"><img src="images/toto.png" alt="She caught Toto by the ear." title="She caught Toto by the ear."/><p class="caption2" id="caption-toto">"<i>She caught Toto by the ear.</i>"</p></div>
<p>${sentence("Later", 2)}</p>
<h2 id="c3">Chapter III</h2>
<p>${sentence("Damaged", 2)}</p>
<div class="figcenter"><img src="images/missing.png" alt="A missing plate"/></div>
<div class="figcenter"><img src="images/broken.png" alt="A damaged plate"/></div>
<p>${sentence("End", 2)}</p>`,
        },
      ],
      resources: [
        { href: "images/toto.png", mediaType: "image/png", data: pngPixel },
        { href: "images/broken.png", mediaType: "image/png", data: truncatedPng },
      ],
      toc: [
        ["part-1.xhtml#c1", "Chapter I"],
        ["part-2.xhtml#c2", "Chapter II"],
        ["part-2.xhtml#c3", "Chapter III"],
      ],
    }),
};

export type EpubFixtureName = keyof typeof epubFixtures;
