import { load, type CheerioAPI } from "cheerio";

// The parts of a parsed node this module reads (domhandler's, which cheerio does not re-export).
interface AnyNode {
  type: string;
  prev: AnyNode | null;
  next: AnyNode | null;
}
interface Comment extends AnyNode {
  type: "comment";
  data: string;
}

// A streamed React document places late content with inline scripts: the HTML first carries a placeholder where it
// belongs (<template id="P:n"> for a segment, or a Suspense fallback marked by <template id="B:n">), and a hidden
// <div id="S:n"> at the end of the body holds what replaces it, moved by $RS("S:n","P:n") or $RC("B:n","S:n").
// Browsers run those scripts; crawlers that do not run JavaScript see the content where it arrived. This applies the
// moves in document order, without running any script, so a check can read the page as it is meant to be laid out
// and tell where each piece of content belongs.

const SWAP = /\$R([SC])\("([^"]+)","([^"]+)"\)/g;

function byId($: CheerioAPI, id: string) {
  return $("[id]")
    .filter((_, element) => $(element).attr("id") === id)
    .first();
}

function isComment(node: AnyNode | null): node is Comment {
  return node?.type === "comment";
}

// The nodes of a Suspense fallback, from its B:n template to the comment that closes its boundary (nested boundaries
// included), and the comment that opened it.
function fallback(template: AnyNode) {
  const opening = template.prev;
  const nodes: AnyNode[] = [];
  let depth = 0;
  for (let node: AnyNode | null = template; node; node = node.next) {
    if (isComment(node) && /^\$[?!]?$/.test(node.data)) depth++;
    if (isComment(node) && node.data === "/$") {
      if (depth === 0) return { opening: isComment(opening) ? opening : null, nodes, closing: node };
      depth--;
    }
    nodes.push(node);
  }
  return null;
}

/** The document after the streamed segments and boundaries reach their placeholders, and how many moved. */
export function resolveStreamedSegments(html: string) {
  const $ = load(html);
  const swaps = $("script")
    .toArray()
    .flatMap((script) => [...$(script).text().matchAll(SWAP)]);
  let resolved = 0;

  for (const [, kind, first, second] of swaps) {
    const [contentId, placeholderId] = kind === "S" ? [first, second] : [second, first];
    const content = byId($, contentId);
    const placeholder = byId($, placeholderId);
    if (!content.length || !placeholder.length) continue;

    if (kind === "S") {
      placeholder.replaceWith(content.contents());
    } else {
      const boundary = fallback(placeholder.get(0) as unknown as AnyNode);
      if (!boundary) continue;
      const nodes = boundary.nodes.map((node) => $(node as never));
      nodes[0].before(content.contents());
      for (const node of nodes) node.remove();
      if (boundary.opening) boundary.opening.data = "$";
    }
    content.remove();
    resolved++;
  }

  return { $, resolved };
}
