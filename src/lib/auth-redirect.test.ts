import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthRedirect } from "./auth-redirect";

test("callback accepts localized paths, queries and fragments for OAuth and email confirmation", () => {
  for (const locale of ["es", "en"]) {
    const next = `/${locale}/library?view=recent#books`;
    assert.equal(safeAuthRedirect(next, "https://www.alyvenor.com").href, `https://www.alyvenor.com${next}`);
  }
});
test("callback rejects external, backslash, control-character and normalized external redirects", () => {
  for (const next of [
    null,
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\t/evil.test",
    "/en/../../auth/callback",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeAuthRedirect(next, "https://www.alyvenor.com").href, "https://www.alyvenor.com/es");
  }
});
