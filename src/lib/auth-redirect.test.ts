import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthRedirect, safeNextPath } from "./auth-redirect";

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

test("L15: safeNextPath returns a locale-prefixed local path or null so callers keep their own default", () => {
  const origin = "https://www.alyvenor.com";

  assert.equal(safeNextPath("/es/account", origin), "/es/account");
  assert.equal(safeNextPath("/en/books/dracula?x=1#top", origin), "/en/books/dracula?x=1#top");
  for (const next of [
    null,
    undefined,
    "",
    "/",
    "/account",
    "//evil.test",
    "https://evil.test",
    "/fr/books",
    "/auth/callback",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeNextPath(next, origin), null, String(next));
  }
});

test("REVIEW: a leading slash is not enough: encoded, dotted, mixed-slash and unicode variants never leave the localized site", () => {
  const origin = "https://www.alyvenor.com";
  const rejected = [
    "/es/../../evil",
    "/es/%2e%2e/%2e%2e/evil",
    "/%2f/evil.test",
    "/%5cevil.test",
    "/\\/evil.test",
    "/es\\evil.test",
    "/es@evil.test",
    "/es:80/x",
    "/esx/books",
    "/ES/books",
    "/es%2fbooks/../..//evil.test",
    "/en/\r\nSet-Cookie: a=b",
    "/en/\u0000",
    "/en/ x",
    "/ /evil.test",
    "/／evil.test",
    "\\\\evil.test",
    "data:text/html,x",
    " /es/library",
  ];

  for (const next of rejected) {
    assert.equal(safeNextPath(next, origin), null, JSON.stringify(next));
    assert.equal(safeAuthRedirect(next, origin).href, `${origin}/es`, JSON.stringify(next));
  }

  // Query and fragment may carry anything printable, but the destination stays same-origin and locale-prefixed.
  // An encoded slash is one opaque segment, not a traversal: it stays inside /es.
  for (const next of [
    "/es?next=https://evil.test",
    "/en/library#//evil.test",
    "/es/books?x=//evil.test",
    "/es/..%2f..%2fevil",
  ]) {
    const destination = safeAuthRedirect(next, origin);
    assert.equal(destination.origin, origin);
    assert.match(destination.pathname, /^\/(es|en)(\/|$)/);
  }
});

test("REVIEW: exhaustively combining 37 hostile fragments yields no accepted redirect outside the site", () => {
  const origin = "https://www.alyvenor.com";
  const atoms = [
    "/",
    "//",
    "\\",
    "%2f",
    "%2F",
    "%5c",
    "..",
    "%2e%2e",
    ".%2e",
    "/.",
    "es",
    "en",
    "evil.com",
    "@",
    ":",
    "?",
    "#",
    "%09",
    "%0a",
    "%0d",
    "%00",
    " ",
    " ",
    "／",
    "。",
    "http:",
    "https://evil.com",
    "//evil.com",
    "\t",
    "\n",
    "x",
    "login",
    ";",
    "&",
    "=",
    "next",
    "\u0000",
  ];
  let accepted = 0;

  for (const a of atoms) {
    for (const b of atoms) {
      for (const c of atoms) {
        for (const prefix of ["/", "/es", "/en/", ""]) {
          const next = `${prefix}${a}${b}${c}`;
          const path = safeNextPath(next, origin);

          if (path === null) continue;
          accepted++;
          const resolved = new URL(path, origin);
          assert.equal(resolved.origin, origin, JSON.stringify(next));
          assert.match(resolved.pathname, /^\/(es|en)(\/|$)/, JSON.stringify(next));
          assert.ok(!path.startsWith("//") && !/[\r\n\\]/.test(path), JSON.stringify(next));
        }
      }
    }
  }

  assert.ok(accepted > 0, "legitimate localized paths are still accepted");
});
