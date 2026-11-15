// pnpm smoke:links [base URL]
//
// Crawls a running build the way a search engine finds pages: from /es, /en and every sitemap URL it follows the
// internal <a href> links of each page, with Googlebot's User-Agent (it gets the blocking HTML, see docs/seo.md). It
// counts the links that point to a page with `noindex`, by kind of target (book page, chapter, other) and of source
// page, and fails if any link points to a book page or a chapter with `noindex`: a book is linked under the locale of
// the edition it shows (src/lib/book-links.ts), so a crawler should never be sent to the other locale's copy.
//
// Other noindex targets (login, register, searches) are reported but do not fail the check.
// Read only: GET requests to the given server, nothing else. Not part of CI, which has no database to build with.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { load } from "cheerio";

import {
  internalLinks,
  isNoindex,
  SOURCE_KINDS,
  summarizeNoindexLinks,
  TARGET_KINDS,
  type LinkEdge,
} from "./lib/link-audit";

const googlebot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const args = process.argv.slice(2).filter((argument) => argument !== "--");
const jsonIndex = args.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
const maxPagesIndex = args.indexOf("--max-pages");
const maxPages = maxPagesIndex >= 0 ? Number(args[maxPagesIndex + 1]) : 5000;
const input =
  args.find(
    (argument, index) =>
      !argument.startsWith("--") && args[index - 1] !== "--json" && args[index - 1] !== "--max-pages",
  ) ?? "http://localhost:3000";
const base = new URL(input);

assert.ok(
  base.protocol === "https:" ||
    (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)),
  "Base URL must be an HTTPS origin or a localhost HTTP origin.",
);
assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
assert.ok(Number.isSafeInteger(maxPages) && maxPages > 0, "--max-pages must be a positive integer");

interface PageResult {
  status: number;
  noindex: boolean;
}

async function fetchPage(path: string) {
  // Canonical and sitemap URLs name production; the crawl stays on the selected server.
  return fetch(new URL(path, base), {
    headers: { "User-Agent": googlebot },
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
}

async function sitemapPaths() {
  const response = await fetchPage("/sitemap.xml");
  assert.equal(response.status, 200, `/sitemap.xml: HTTP ${response.status}`);
  const sitemap = load(await response.text(), { xmlMode: true });

  return sitemap("url > loc")
    .map((_, element) => {
      const url = new URL(sitemap(element).text());
      return `${url.pathname}${url.search}`;
    })
    .get();
}

async function main() {
  const seeds = ["/es", "/en", ...(await sitemapPaths())];
  const queue = [...new Set(seeds)];
  const queued = new Set(queue);
  const pages = new Map<string, PageResult>();
  const edges: LinkEdge[] = [];

  async function visit(path: string) {
    const response = await fetchPage(path);
    const html = response.headers.get("content-type")?.includes("text/html") ? await response.text() : "";
    pages.set(path, { status: response.status, noindex: isNoindex(html, response.headers.get("x-robots-tag")) });

    if (response.status !== 200 || !html) return;

    for (const target of internalLinks(html, new URL(path, base))) {
      edges.push({ source: path, target });
      if (!queued.has(target)) {
        queued.add(target);
        queue.push(target);
      }
    }
  }

  // A few requests at a time: a local production build answers each page from its cache or the database.
  const concurrency = 4;
  while (queue.length > 0) {
    assert.ok(pages.size + queue.length <= maxPages + concurrency, `More than ${maxPages} pages: raise --max-pages`);
    await Promise.all(queue.splice(0, concurrency).map(visit));
  }

  const noindex = new Set([...pages].filter(([, page]) => page.noindex).map(([path]) => path));
  const summary = summarizeNoindexLinks(edges, noindex);
  const statuses = [...pages.values()].reduce<Record<number, number>>((counts, page) => {
    counts[page.status] = (counts[page.status] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`Pages crawled: ${pages.size} (HTTP ${JSON.stringify(statuses)}); noindex pages: ${noindex.size}`);
  console.log(`Internal links (one per source page and target): ${edges.length}`);
  console.log(`Links to noindex pages: ${summary.total} (distinct noindex targets: ${summary.distinctTargets})`);
  console.log(`\n| Source \\ target | ${TARGET_KINDS.join(" | ")} | total |`);
  console.log(`|---|${TARGET_KINDS.map(() => "---:").join("|")}|---:|`);
  for (const source of SOURCE_KINDS) {
    const row = TARGET_KINDS.map((target) => summary.matrix[source][target]);
    console.log(`| ${source} | ${row.join(" | ")} | ${summary.bySource[source]} |`);
  }
  console.log(`| total | ${TARGET_KINDS.map((target) => summary.byTarget[target]).join(" | ")} | ${summary.total} |`);

  const otherTargets = [...new Set(edges.filter((edge) => noindex.has(edge.target)).map((edge) => edge.target))]
    .filter((target) => !/^\/(?:es|en)\/books\/[^/?]+(?:\/[^/?]+)?(?:\?|$)/.test(target))
    .sort();
  console.log(`\nOther noindex targets: ${otherTargets.join(", ") || "none"}`);

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ pages: Object.fromEntries(pages), edges, summary }, null, 2));
  }

  const crossed = edges.filter(
    (edge) => noindex.has(edge.target) && /^\/(?:es|en)\/books\/[^/?]+(?:\/[^/?]+)?(?:\?|$)/.test(edge.target),
  );
  assert.equal(
    crossed.length,
    0,
    `Links to book pages or chapters with noindex:\n${crossed
      .slice(0, 20)
      .map((edge) => `  ${edge.source} -> ${edge.target}`)
      .join("\n")}${crossed.length > 20 ? `\n  … and ${crossed.length - 20} more` : ""}`,
  );
  console.log("\nPASS no link points to a book page or chapter with noindex");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
