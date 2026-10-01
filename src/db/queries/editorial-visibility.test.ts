import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core/dialect";

import { getPublicEditionVisibilityCondition } from "./editorial-visibility";

test("public edition query only includes published editions with eligible copyright", () => {
  const condition = getPublicEditionVisibilityCondition();
  assert.ok(condition);

  const query = new PgDialect().sqlToQuery(condition);

  assert.deepEqual(query.params, ["PUBLISHED", "PUBLIC_DOMAIN_VERIFIED", "LICENSED", "ORIGINAL"]);
  assert.match(query.sql, /"publication_status" = \$1/);
  assert.match(query.sql, /"copyright_status" in \(\$2, \$3, \$4\)/);
});
