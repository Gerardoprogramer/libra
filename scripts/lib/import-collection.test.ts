import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import JSZip from "jszip";

import { initialLibrary } from "../catalog/initial-library";
import { parseEpub } from "./parse-epub";
import {
  importCollection,
  parseCollectionArguments,
  parseCollectionManifest,
  type CatalogEntry,
} from "./import-collection";
import { formatImportError } from "./import-errors";
import { importGutenbergBook, type ImportGutenbergOptions } from "./import-gutenberg";

const dracula: CatalogEntry = {
  file: "imports/dracula.epub",
  gutenbergId: 345,
  slug: "dracula",
  originalTitle: "Dracula",
  originalLanguage: "en",
  year: 1897,
};

function captureOutput() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    },
  };
}

async function createProject(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "libra-collection-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith("libra-collection-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(directory, "imports"));
  return directory;
}

function setEnvironment(t: TestContext, values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function createEpub(file: string, additionalMetadata = "") {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Test Book</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language>${additionalMetadata}</metadata>
      <manifest>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
      </manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`,
  );
  zip.file(
    "chapter.xhtml",
    `<html><body><h1>Chapter One</h1><p>${"An original test sentence. ".repeat(20)}</p></body></html>`,
  );
  zip.file("cover.jpg", Buffer.from("test cover bytes"));
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
}

test("EPUB translator metadata is separated from author metadata", async (t) => {
  const projectRoot = await createProject(t);
  const file = path.join(projectRoot, "imports", "translated.epub");
  await createEpub(
    file,
    '<dc:contributor id="translator">Spanish Translator</dc:contributor><meta refines="#translator" property="role" scheme="marc:relators">trl</meta>',
  );

  const epub = await parseEpub(await fs.readFile(file));

  assert.deepEqual(epub.creators, ["Test Author"]);
  assert.equal(epub.translator, "Spanish Translator");
});

test("the initial manifest is valid; optional years and multiple editions of a book are supported", () => {
  assert.deepEqual(parseCollectionManifest(initialLibrary), initialLibrary);
  const translated = {
    file: "imports/dracula-es.epub",
    gutenbergId: 999,
    slug: "dracula",
    originalTitle: "Dracula",
    originalLanguage: "en",
  };
  assert.deepEqual(parseCollectionManifest([dracula, translated]), [dracula, translated]);
  assert.deepEqual(parseCollectionManifest([{ ...dracula, editionPublicationYear: 1920 }]), [
    { ...dracula, editionPublicationYear: 1920 },
  ]);
  assert.equal(parseCollectionManifest([{ ...dracula, file: "imports\\dracula.epub" }])[0].file, dracula.file);
});

test("malformed manifests, unknown fields and invalid identifiers are rejected", () => {
  for (const value of [null, {}, "[]", [], Array(2), [null], [[]], [{ ...dracula, categories: ["horror"] }]]) {
    assert.throws(() => parseCollectionManifest(value), /manifest|Manifest/);
  }
  for (const gutenbergId of ["345", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseCollectionManifest([{ ...dracula, gutenbergId }]), /gutenbergId/);
  }
  for (const slug of ["", "Dracula", "bad_slug", "bad--slug", "../dracula", "a".repeat(252)]) {
    assert.throws(() => parseCollectionManifest([{ ...dracula, slug }]), /slug/);
  }
  for (const year of ["1897", null, 1897.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => parseCollectionManifest([{ ...dracula, year }]), /year/);
  }
  for (const editionPublicationYear of ["1920", null, 1920.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => parseCollectionManifest([{ ...dracula, editionPublicationYear }]), /editionPublicationYear/);
  }
});

test("the manifest only accepts local EPUB paths inside imports and rejects duplicate sources", () => {
  for (const file of [
    undefined,
    "https://example.com/book.epub",
    "/tmp/book.epub",
    "C:\\book.epub",
    "imports/../book.epub",
    "imports/book.txt",
    "imports/bad\0.epub",
  ]) {
    assert.throws(() => parseCollectionManifest([{ ...dracula, file }]), /file/);
  }
  assert.throws(() => parseCollectionManifest([dracula, { ...dracula, file: "imports/second.epub" }]), /duplicate/);
  assert.throws(() => parseCollectionManifest([dracula, { ...dracula, gutenbergId: 84 }]), /duplicate/);
  assert.throws(
    () => parseCollectionManifest([dracula, { ...dracula, file: "imports/./DRACULA.epub", gutenbergId: 84 }]),
    /duplicate/,
  );
});

test("CLI defaults to dry run and accepts the pnpm separator, apply, fail-fast and help", () => {
  assert.deepEqual(parseCollectionArguments([]), { apply: false, failFast: false, help: false });
  assert.deepEqual(parseCollectionArguments(["--", "--apply", "--fail-fast"]), {
    apply: true,
    failFast: true,
    help: false,
  });
  assert.equal(parseCollectionArguments(["--apply"]).apply, true);
  assert.equal(parseCollectionArguments(["--help"]).help, true);
  assert.equal(parseCollectionArguments(["-h"]).help, true);
});

test("invalid CLI options never silently fall back to another mode", () => {
  for (const args of [
    ["--aply"],
    ["--apply=false"],
    ["--apply", "false"],
    ["--file", "imports/dracula.epub"],
    ["dracula"],
  ]) {
    assert.throws(() => parseCollectionArguments(args));
  }
});

test("the whole manifest is validated before any import starts", async (t) => {
  const projectRoot = await createProject(t);
  let calls = 0;
  await assert.rejects(
    importCollection(
      [dracula, { ...dracula, gutenbergId: 0 }],
      { projectRoot, apply: true },
      {
        importBook: async () => {
          calls++;
        },
        logger: captureOutput().logger,
      },
    ),
    /entry #2/,
  );
  assert.equal(calls, 0);
});

test("a missing EPUB is reported, later books still run, and the result signals failure", async (t) => {
  const projectRoot = await createProject(t);
  const second = {
    file: "imports/second.epub",
    gutenbergId: 84,
    slug: "second",
    originalTitle: "Second",
    originalLanguage: "en",
  };
  await fs.writeFile(path.join(projectRoot, second.file), "runner fixture");
  const calls: ImportGutenbergOptions[] = [];
  const { logger, lines } = captureOutput();
  const result = await importCollection(
    [dracula, second],
    { projectRoot },
    {
      logger,
      importBook: async (options) => {
        calls.push(options);
      },
    },
  );
  assert.deepEqual(result, { succeeded: 1, missing: 1, failed: 0, notProcessed: 0, exitCode: 1 });
  assert.deepEqual(
    calls.map(({ slug, apply }) => ({ slug, apply })),
    [{ slug: "second", apply: false }],
  );
  assert(lines.some((line) => line.includes("MISSING") && line.includes(dracula.file)));
  assert(lines.some((line) => line.includes("Summary (DRY RUN)")));
});

test("directories masquerading as EPUBs are errors and are not passed to the importer", async (t) => {
  const projectRoot = await createProject(t);
  await fs.mkdir(path.join(projectRoot, dracula.file));
  const { logger, lines } = captureOutput();
  const result = await importCollection(
    [dracula],
    { projectRoot },
    {
      logger,
      importBook: async () => {
        assert.fail("Not an EPUB file");
      },
    },
  );
  assert.equal(result.failed, 1);
  assert.equal(result.exitCode, 1);
  assert(lines.some((line) => line.includes("not a regular file")));
});

test("apply processes ten books sequentially and continues after book four fails", async (t) => {
  const projectRoot = await createProject(t);
  const entries = Array.from({ length: 10 }, (_, index) => ({
    file: `imports/book-${index + 1}.epub`,
    gutenbergId: index + 1,
    slug: `book-${index + 1}`,
    originalTitle: `Book ${index + 1}`,
    originalLanguage: "en",
    year: 1897,
  }));
  for (const entry of entries) await fs.writeFile(path.join(projectRoot, entry.file), "runner fixture");
  const started: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const { logger, lines } = captureOutput();
  const result = await importCollection(
    entries,
    { apply: true, projectRoot },
    {
      logger,
      importBook: async (options) => {
        assert.equal(options.apply, true);
        assert.equal(options.year, 1897);
        assert.equal(options.editionPublicationYear, undefined);
        assert.equal(options.file, path.join(projectRoot, `imports/${options.slug}.epub`));
        started.push(options.gutenbergId);
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        if (options.gutenbergId === "4") throw new Error("Book four failed");
      },
    },
  );
  assert.deepEqual(
    started,
    entries.map((entry) => String(entry.gutenbergId)),
  );
  assert.equal(maximumActive, 1);
  assert.deepEqual(result, { succeeded: 9, missing: 0, failed: 1, notProcessed: 0, exitCode: 1 });
  assert(lines.some((line) => line.includes("[4/10]") && line.includes("FAILED") && line.includes("Book four failed")));
  assert(lines.some((line) => line.includes("[10/10]") && line.includes("OK")));
});

test("fail-fast stops both on a missing EPUB and on an importer failure", async (t) => {
  const projectRoot = await createProject(t);
  const second = {
    file: "imports/second.epub",
    gutenbergId: 84,
    slug: "second",
    originalTitle: "Second",
    originalLanguage: "en",
  };
  let calls = 0;
  const dependencies = {
    logger: captureOutput().logger,
    importBook: async () => {
      calls++;
      throw new Error("Invalid EPUB");
    },
  };
  const missing = await importCollection([dracula, second], { projectRoot, failFast: true }, dependencies);
  assert.equal(calls, 0);
  assert.deepEqual(missing, { succeeded: 0, missing: 1, failed: 0, notProcessed: 1, exitCode: 1 });
  await fs.writeFile(path.join(projectRoot, dracula.file), "runner fixture");
  const failed = await importCollection([dracula, second], { projectRoot, failFast: true }, dependencies);
  assert.equal(calls, 1);
  assert.deepEqual(failed, { succeeded: 0, missing: 0, failed: 1, notProcessed: 1, exitCode: 1 });
});

test("real dry-run parses chapters and a cover with no DB, R2 or invalidation credentials", async (t) => {
  const projectRoot = await createProject(t);
  await createEpub(path.join(projectRoot, dracula.file));
  setEnvironment(t, {
    DIRECT_DATABASE_URL: undefined,
    R2_ACCOUNT_ID: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    R2_BUCKET_NAME: undefined,
    R2_PUBLIC_URL: undefined,
    CACHE_REVALIDATION_URL: undefined,
    CACHE_REVALIDATION_SECRET: undefined,
  });
  const printed: unknown[][] = [];
  t.mock.method(console, "log", (...args: unknown[]) => printed.push(args));
  const result = await importCollection([dracula], { projectRoot });
  assert.equal(result.exitCode, 0);
  assert.equal(result.succeeded, 1);
  assert(printed.some((args) => String(args[0]).includes("Chapters detected: 1")));
  assert(printed.some((args) => String(args[0]).includes("Cover: image/jpeg")));
  assert(printed.some((args) => String(args[0]).includes("Dry run only")));
});

test("the single shared importer defaults to dry-run even with an unusable database URL", async (t) => {
  const projectRoot = await createProject(t);
  const file = path.join(projectRoot, dracula.file);
  await createEpub(file);
  setEnvironment(t, { DIRECT_DATABASE_URL: "invalid-database-url", R2_ACCOUNT_ID: undefined });
  t.mock.method(console, "log", () => {});
  await importGutenbergBook({
    file,
    gutenbergId: "345",
    slug: "dracula",
    originalTitle: "Dracula",
    originalLanguage: "en",
    year: 1897,
  });
});

test("real apply requires database configuration before attempting any cover upload", async (t) => {
  const projectRoot = await createProject(t);
  const file = path.join(projectRoot, dracula.file);
  await createEpub(file);
  setEnvironment(t, { DIRECT_DATABASE_URL: undefined, R2_ACCOUNT_ID: undefined });
  t.mock.method(console, "log", () => {});
  await assert.rejects(
    importGutenbergBook({
      file,
      gutenbergId: "345",
      originalTitle: "Dracula",
      originalLanguage: "en",
      apply: true,
    }),
    /DIRECT_DATABASE_URL is not defined/,
  );
});

test("a corrupt EPUB fails individually while the next real dry-run succeeds", async (t) => {
  const projectRoot = await createProject(t);
  const second = {
    file: "imports/second.epub",
    gutenbergId: 84,
    slug: "second",
    originalTitle: "Second",
    originalLanguage: "en",
  };
  await fs.writeFile(path.join(projectRoot, dracula.file), "Not a zip");
  await createEpub(path.join(projectRoot, second.file));
  t.mock.method(console, "log", () => {});
  const { logger, lines } = captureOutput();
  const result = await importCollection([dracula, second], { projectRoot }, { logger });
  assert.deepEqual(result, { succeeded: 1, missing: 0, failed: 1, notProcessed: 0, exitCode: 1 });
  assert(lines.some((line) => line.includes("FAILED") && line.includes("zip")));
});

test("error reports include the driver cause and code but redact credentials and query parameters", (t) => {
  setEnvironment(t, {
    DIRECT_DATABASE_URL: "postgres://editor:private%2Fpassword@example.test/libra",
    R2_SECRET_ACCESS_KEY: "private-r2-key",
    CACHE_REVALIDATION_SECRET: "private-cache-token",
  });
  const cause = Object.assign(
    new Error(
      `Connection failed: ${process.env.DIRECT_DATABASE_URL}, private/password, private-r2-key, private-cache-token`,
    ),
    { code: "ECONNREFUSED" },
  );
  const error = new Error("Failed query: SQL AND EPUB CONTENT", { cause });
  const message = formatImportError(error);
  assert(message.includes("ECONNREFUSED") && message.includes("Connection failed"));
  assert(!message.includes("private") && !message.includes("postgres://") && !message.includes("SQL AND EPUB CONTENT"));
});
