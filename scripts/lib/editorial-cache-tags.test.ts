import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEditorialCacheTags } from "../../src/lib/editorial-cache-tags";

test("editorial cache tags accept known aliases, validate slugs, and deduplicate", () => {
  assert.deepEqual(
    parseEditorialCacheTags({
      tags: ["library", "library:editorial", "book:dracula", "chapter:dracula:chapter-one", "book:dracula"],
    }),
    ["library:editorial", "book:dracula", "chapter:dracula:chapter-one"],
  );
});

test("editorial cache tag validation rejects malformed payloads and unsafe tags", () => {
  for (const payload of [
    null,
    [],
    {},
    { tags: [] },
    { tags: ["book:dracula"], unexpected: true },
    { tags: Array.from({ length: 51 }, () => "library") },
    { tags: [42] },
    { tags: ["book:../dracula"] },
    { tags: ["chapter:dracula"] },
    { tags: ["x".repeat(257)] },
  ]) {
    assert.equal(parseEditorialCacheTags(payload), null);
  }
});
