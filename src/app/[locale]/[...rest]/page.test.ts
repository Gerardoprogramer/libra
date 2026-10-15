import assert from "node:assert/strict";
import { test } from "node:test";

import UnknownLocalizedPage from "./page";

test("L07: an unmatched localized URL raises Next's not-found signal so the localized 404 renders", () => {
  assert.throws(
    () => UnknownLocalizedPage(),
    (error: unknown) => (error as { digest?: string }).digest === "NEXT_HTTP_ERROR_FALLBACK;404",
  );
});
