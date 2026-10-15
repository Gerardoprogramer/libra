import assert from "node:assert/strict";
import { test } from "node:test";

import { extractEpubSections, extractEpubSectionsWithReport, type EpubDocument } from "./epub-sections";

// In-memory documents only: no ZIP, database, R2 or network access.
const prose = (label: string, words = 40) => `${label} `.repeat(words).trim();
const section = (title: string, body = prose(`${title} texto`), tag = "h2") =>
  `<${tag}>${title}</${tag}><p>${body}</p>`;
const xhtml = (body: string, path = "OEBPS/text.xhtml"): EpubDocument => ({
  path,
  xhtml: true,
  html: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>doc</title></head><body>${body}</body></html>`,
});
const titles = (documents: EpubDocument[], bookTitle = "Libro de prueba") =>
  extractEpubSections(documents, [], bookTitle).map((item) => item.title);

test("L01: generic words such as 'parte' or 'notas' inside a literary title do not discard the section", () => {
  const documents = [
    xhtml(
      [
        section("Capítulo I"),
        section("Una parte de la verdad"),
        section("Notas de un viajero"),
        section("Capítulo IV"),
      ].join(""),
    ),
  ];

  assert.deepEqual(titles(documents), ["Capítulo I", "Una parte de la verdad", "Notas de un viajero", "Capítulo IV"]);
});

test("L01: text belonging to every retained section is preserved with its own body", () => {
  const sections = extractEpubSections(
    [
      xhtml(
        section("Capítulo I", "Primero.") +
          section("Parte de la noche", "Segundo texto literario.") +
          section("Capítulo III", "Tercero."),
      ),
    ],
    [],
    "Libro de prueba",
  );

  assert.deepEqual(
    sections.map((item) => [item.title, item.content]),
    [
      ["Capítulo I", "Primero."],
      ["Parte de la noche", "Segundo texto literario."],
      ["Capítulo III", "Tercero."],
    ],
  );
});

test("English titles that merely contain 'part' or 'notes' are kept", () => {
  const documents = [
    xhtml(
      [
        section("Take Part in the Hunt"),
        section("Notes from the Underground"),
        section("A Part of Speech"),
        section("Introductions and Farewells"),
      ].join(""),
    ),
  ];

  assert.deepEqual(titles(documents), [
    "Take Part in the Hunt",
    "Notes from the Underground",
    "A Part of Speech",
    "Introductions and Farewells",
  ]);
});

test("lowercase words made only of roman-numeral letters are chapter titles, not roman markers", () => {
  const documents = [
    xhtml([section("civil"), section("mild"), section("dim"), section("did"), section("vivid")].join("")),
  ];

  assert.deepEqual(titles(documents), ["civil", "mild", "dim", "did", "vivid"]);
});

test("uppercase words made of roman letters are not merged with the next heading as a chapter marker", () => {
  const documents = [xhtml("<h2>MIX</h2><h3>Of Lovers</h3><p>" + prose("amor") + "</p>")];

  assert.deepEqual(titles(documents), ["MIX"]);
});

test("real roman markers still merge with the following title heading", () => {
  const documents = [xhtml("<h2>CHAPTER IV</h2><h3>The Storm</h3><p>" + prose("storm") + "</p>")];

  assert.deepEqual(titles(documents), ["CHAPTER IV The Storm"]);
});

test("part dividers without prose are structural and reported, but literary 'Parte…' titles are kept", () => {
  const documents = [
    xhtml(
      [
        "<h2>Parte primera</h2>",
        section("Capítulo I"),
        "<h2>PART TWO: The Voyage</h2>",
        section("Capítulo II"),
        section("Parte de la noche"),
      ].join(""),
    ),
  ];
  const { sections, report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.deepEqual(
    sections.map((item) => item.title),
    ["Capítulo I", "Capítulo II", "Parte de la noche"],
  );
  assert.deepEqual(
    report.discarded.map(({ title, reason }) => [title, reason]),
    [
      ["Parte primera", "part-divider"],
      ["PART TWO: The Voyage", "part-divider"],
    ],
  );
});

test("unmistakable paratext is dropped and reported with its approximate size", () => {
  const documents = [
    xhtml(
      [
        section("Preface", prose("prefacio", 25)),
        section("Notes", prose("nota", 12)),
        section("Notas del traductor", prose("traductor", 7)),
        section("Capítulo I", prose("uno", 400)),
      ].join(""),
    ),
  ];
  const { sections, report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.deepEqual(
    sections.map((item) => item.title),
    ["Capítulo I"],
  );
  assert.deepEqual(
    report.discarded.map(({ title, reason, words }) => [title, reason, words >= 7]),
    [
      ["Preface", "paratext", true],
      ["Notes", "paratext", true],
      ["Notas del traductor", "paratext", true],
    ],
  );
  assert.ok(report.discarded.every((item) => item.definitive));
  assert.deepEqual(report.warnings, []);
});

test("a discarded structural section that carries substantial prose raises a review warning instead of vanishing", () => {
  const documents = [xhtml("<h2>Parte primera</h2>" + `<p>${prose("epigrafe", 400)}</p>` + section("Capítulo I"))];
  const { sections, report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.deepEqual(
    sections.map((item) => item.title),
    ["Capítulo I"],
  );
  assert.equal(report.discarded[0]?.title, "Parte primera");
  assert.equal(report.discarded[0]?.definitive, false);
  assert.match(report.warnings.join("\n"), /Parte primera[\s\S]*part-divider[\s\S]*review/);
});

test("L01: numbered subsections (-ii-, -iii-) continue their chapter instead of being discarded", () => {
  // Fortunata y Jacinta structure: "-I-" + title, then "-i-", "-ii-", "-iii-" inside the same chapter.
  const documents = [
    xhtml(
      [
        "<h2>-I-</h2><h2>Un caballero</h2>",
        "<h2>-i-</h2>",
        `<p>${prose("primera", 30)}</p>`,
        "<h2>-ii-</h2>",
        `<p>${prose("segunda", 30)}</p>`,
        "<h2>-iii-</h2>",
        `<p>${prose("tercera", 30)}</p>`,
        "<h2>-II-</h2><h2>Otro capítulo</h2>",
        `<p>${prose("siguiente", 30)}</p>`,
      ].join(""),
    ),
  ];
  const { sections, report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.deepEqual(
    sections.map((item) => item.title),
    ["-I- Un caballero", "-II- Otro capítulo"],
  );
  const first = sections[0].content;
  assert.ok(first.includes("primera") && first.includes("segunda") && first.includes("tercera"));
  assert.ok(first.indexOf("segunda") > first.indexOf("primera") && first.indexOf("tercera") > first.indexOf("segunda"));
  assert.ok(first.split("\n\n").includes("-ii-") && first.split("\n\n").includes("-iii-"));
  assert.ok(!first.split("\n\n").includes("-II-"), "the next chapter's marker never ends the previous chapter");
  assert.equal(report.mergedSubsections, 2);
  assert.deepEqual(report.discarded, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.keptWords + report.discardedWords + report.leadingWords, report.totalWords);
});

test("variable subsection counts, spelling variants and navigation on the marker keep every text exactly once", () => {
  // The navigation points at the "-II-" marker (as in the Gutenberg Fortunata EPUB), chapters hold 0, 1, 3 and 5
  // subsections, the numerals vary in case, spacing, dash and entities, and one chapter spans a second file.
  const documents = [
    xhtml(
      [
        '<h2 id="m1">-I-</h2><h2>Sin subdivisiones</h2>',
        `<p>${prose("alfa", 25)}</p>`,
        '<h2 id="m2">-II-</h2><h2>Con una</h2><h2>-i-</h2>',
        `<p>${prose("bravo", 25)}</p>`,
        '<h2 id="m3">-III-</h2><h2>Con tres</h2><h2>- i -</h2>',
        `<p>${prose("golf", 25)}</p>`,
        "<h2>&#8211; ii &#8211;</h2>",
        `<p>${prose("delta", 25)}</p>`,
        "<h2>-iii-</h2>",
        `<p>${prose("eco", 25)}</p>`,
      ].join(""),
      "OEBPS/a.xhtml",
    ),
    xhtml(
      [
        '<h2 id="m4">-IV-</h2><h2>Con cinco</h2><h2>i-</h2>',
        `<p>${prose("zulu", 25)}</p>`,
        "<h2>-ii-</h2>",
        `<p>${prose("echo", 25)}</p>`,
        "<h2>-iii-</h2>",
        `<p>${prose("tango", 25)}</p>`,
        "<h2>&nbsp;-iv-&nbsp;</h2>",
        `<p>${prose("india", 25)}</p>`,
        "<h2>-v-</h2>",
        `<p>${prose("kilo", 25)}</p>`,
      ].join(""),
      "OEBPS/b.xhtml",
    ),
  ];
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${[
    "a:m1",
    "a:m2",
    "a:m3",
    "b:m4",
  ]
    .map(
      (id, index) =>
        `<navPoint id="n${index}"><navLabel><text>${id}</text></navLabel><content src="${id.split(":")[0]}.xhtml#${id.split(":")[1]}"/></navPoint>`,
    )
    .join("")}</navMap></ncx>`;
  const { sections, report } = extractEpubSectionsWithReport(
    documents,
    [{ path: "OEBPS/toc.ncx", content: ncx, kind: "ncx" }],
    "Libro de prueba",
  );

  assert.deepEqual(
    sections.map((item) => item.title),
    ["-I- Sin subdivisiones", "-II- Con una", "-III- Con tres", "-IV- Con cinco"],
  );
  for (const word of ["alfa", "bravo", "golf", "delta", "eco", "zulu", "echo", "tango", "india", "kilo"]) {
    const holders = sections.filter((item) => item.content.includes(word));
    assert.equal(holders.length, 1, `${word} appears in exactly one chapter`);
    assert.equal(holders[0].content.split(word).length - 1, 25, `${word} appears 25 times, none lost or repeated`);
  }
  assert.ok(sections[2].content.indexOf("golf") < sections[2].content.indexOf("delta"));
  assert.ok(sections[2].content.indexOf("delta") < sections[2].content.indexOf("eco"));
  assert.ok(sections[3].content.indexOf("zulu") < sections[3].content.indexOf("kilo"));
  for (const item of sections) {
    const last = item.content.split("\n\n").at(-1)!;
    assert.ok(!/^-[IVXL]+-$/.test(last), `"${item.title}" does not end with the next chapter's marker`);
  }
  assert.equal(report.mergedSubsections, 6, "ii and iii of III, ii to v of IV");
  assert.deepEqual(report.discarded, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.keptWords + report.discardedWords + report.leadingWords, report.totalWords);
});

// As in the Gutenberg Fortunata EPUB, the navigation lists each closing line as an entry of its own.
function navigation(entries: [id: string, label: string][]) {
  const points = entries
    .map(
      ([id, label], index) =>
        `<navPoint id="n${index}"><navLabel><text>${label}</text></navLabel><content src="text.xhtml#${id}"/></navPoint>`,
    )
    .join("");

  return [
    {
      path: "OEBPS/toc.ncx",
      content: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`,
      kind: "ncx" as const,
    },
  ];
}

test("the closing lines of a part stay at the end of its last chapter, never in a title or a new chapter", () => {
  const documents = [
    xhtml(
      [
        '<h2 id="a">-I-</h2><h2>Primero</h2>',
        `<p>${prose("alfa", 25)}</p>`,
        '<h2 id="b">-II-</h2><h2>Ultimo</h2>',
        `<p>${prose("bravo", 25)}</p>`,
        '<h3 id="d1">Madrid.—Enero de 1886.</h3><h3 id="f1">FIN DE LA PRIMERA PARTE</h3>',
        '<h1 id="t">Titulo</h1><h2 id="p">PARTE SEGUNDA</h2>',
        '<h2 id="c">-I-</h2><h2>Nuevo comienzo</h2>',
        `<p>${prose("charlie", 25)}</p>`,
        '<h3 id="d2">Madrid.—Junio de 1887.</h3><h3 id="f2">FIN DE LA NOVELA</h3>',
      ].join(""),
      "OEBPS/text.xhtml",
    ),
  ];
  const { sections, report } = extractEpubSectionsWithReport(
    documents,
    navigation([
      ["a", "-I- Primero"],
      ["b", "-II- Ultimo"],
      ["d1", "Madrid.—Enero de 1886. FIN DE LA PRIMERA PARTE"],
      ["f1", "FIN DE LA PRIMERA PARTE"],
      ["t", "Titulo"],
      ["p", "PARTE SEGUNDA"],
      ["c", "-I- Nuevo comienzo"],
      ["d2", "Madrid.—Junio de 1887."],
      ["f2", "FIN DE LA NOVELA"],
    ]),
    "Libro de prueba",
  );

  assert.deepEqual(
    sections.map((item) => item.title),
    ["-I- Primero", "-II- Ultimo", "-I- Nuevo comienzo"],
  );
  assert.deepEqual(sections[1].content.split("\n\n").slice(-2), ["Madrid.—Enero de 1886.", "FIN DE LA PRIMERA PARTE"]);
  assert.deepEqual(sections[2].content.split("\n\n").slice(-2), ["Madrid.—Junio de 1887.", "FIN DE LA NOVELA"]);
  assert.ok(!sections[0].content.includes("FIN DE LA"), "an earlier chapter does not receive them");
  assert.equal(report.closingLines, 4);
  assert.equal(report.keptWords + report.discardedWords + report.leadingWords, report.totalWords);
});

test("only the dated place line and the FIN formula are kept: other short entries are still discarded", () => {
  const documents = [
    xhtml(
      [
        '<h2 id="a">Capitulo I</h2>',
        `<p>${prose("alfa", 25)}</p>`,
        '<h2 id="x">Fin</h2><h2 id="y">FIN DE LA JORNADA</h2><h2 id="z">Fin de la novela</h2>',
        '<h2 id="b">Capitulo II</h2>',
        `<p>${prose("bravo", 25)}</p>`,
      ].join(""),
      "OEBPS/text.xhtml",
    ),
  ];
  const { sections, report } = extractEpubSectionsWithReport(
    documents,
    navigation([
      ["a", "Capitulo I"],
      ["x", "Fin"],
      ["y", "FIN DE LA JORNADA"],
      ["z", "Fin de la novela"],
      ["b", "Capitulo II"],
    ]),
    "Libro de prueba",
  );

  assert.equal(report.closingLines, 0);
  assert.ok(!sections.some((item) => /FIN|Fin/.test(item.content)));
});

test("a numbered subsection with no chapter to continue is discarded but flagged when it holds text", () => {
  const documents = [xhtml("<h3>ii</h3>" + `<p>${prose("huerfano", 150)}</p>` + section("Capítulo I"))];
  const { report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.deepEqual(
    report.discarded.map(({ title, reason, definitive }) => [title, reason, definitive]),
    [["ii", "roman-subsection", false]],
  );
  assert.match(report.warnings.join("\n"), /"ii"[\s\S]*roman-subsection[\s\S]*review/);
});

test("a definitive large discard asks for confirmation instead of passing silently", () => {
  const documents = [xhtml(section("Preface", prose("ensayo", 1600)) + section("Capítulo I", prose("uno", 3000)))];
  const { report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.match(report.warnings.join("\n"), /"Preface" \(paratext\) discards ~16\d\d words; confirm/);
});

test("report accounts for every word: kept + discarded + leading equals the readable total", () => {
  const documents = [
    xhtml(
      [
        `<p>${prose("frontispicio", 9)}</p>`,
        section("Preface", prose("prefacio", 20)),
        section("Capítulo I", prose("uno", 31)),
        section("Capítulo II", prose("dos", 17)),
      ].join(""),
    ),
  ];
  const { report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.equal(report.keptWords + report.discardedWords + report.leadingWords, report.totalWords);
  assert.ok(report.leadingWords >= 9);
  assert.ok(report.discardedWords >= 20);
  assert.ok(report.keptWords >= 48);
});

test("leading prose before the first section is reported, never lost silently", () => {
  const documents = [xhtml(`<p>${prose("dedicatoria", 150)}</p>` + section("Capítulo I"))];
  const { report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.ok(report.leadingWords >= 150);
  assert.match(report.warnings.join("\n"), /before the first section/i);
});

test("navigation entries that point nowhere are reported", () => {
  const documents = [xhtml(section("Capítulo I"), "OEBPS/text.xhtml")];
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
    <navPoint><navLabel><text>Capítulo I</text></navLabel><content src="text.xhtml"/></navPoint>
    <navPoint><navLabel><text>Capítulo perdido</text></navLabel><content src="missing.xhtml"/></navPoint>
  </navMap></ncx>`;
  const { sections, report } = extractEpubSectionsWithReport(
    documents,
    [{ path: "OEBPS/toc.ncx", content: ncx, kind: "ncx" }],
    "Libro de prueba",
  );

  assert.deepEqual(
    sections.map((item) => item.title),
    ["Capítulo I"],
  );
  assert.deepEqual(report.unresolvedNavigation, ["Capítulo perdido"]);
  assert.match(report.warnings.join("\n"), /Capítulo perdido/);
});

test("a document without headings becomes one reading unit instead of disappearing", () => {
  const documents = [xhtml(`<p>${prose("sin encabezado", 60)}</p>`)];
  const { sections } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.equal(sections.length, 1);
  assert.match(sections[0].content, /sin encabezado/);
});

test("a navigation anchor without any heading still produces its section", () => {
  const documents = [xhtml(`<p id="a">${prose("alfa", 30)}</p><p id="b">${prose("beta", 30)}</p>`, "OEBPS/text.xhtml")];
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
    <navPoint><navLabel><text>Primera</text></navLabel><content src="text.xhtml#a"/></navPoint>
    <navPoint><navLabel><text>Segunda</text></navLabel><content src="text.xhtml#b"/></navPoint>
  </navMap></ncx>`;

  const sections = extractEpubSections(
    documents,
    [{ path: "OEBPS/toc.ncx", content: ncx, kind: "ncx" }],
    "Libro de prueba",
  );

  assert.deepEqual(
    sections.map((item) => item.title),
    ["Primera", "Segunda"],
  );
  assert.match(sections[0].content, /alfa/);
  assert.match(sections[1].content, /beta/);
});

test("a heading-only Part page is reported as having no prose, not as lost literature", () => {
  const documents = [xhtml("<h2>Libro segundo</h2>" + section("Capítulo I"))];
  const { sections, report } = extractEpubSectionsWithReport(documents, [], "Libro de prueba");

  assert.deepEqual(
    sections.map((item) => item.title),
    ["Libro segundo", "Capítulo I"].filter((title) => sections.some((item) => item.title === title)),
  );
  assert.ok(report.warnings.every((warning) => !/Libro segundo/.test(warning)));
});
