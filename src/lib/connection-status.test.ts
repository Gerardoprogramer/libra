import assert from "node:assert/strict";
import { test } from "node:test";

import { nextConnectionNotice, RESTORED_NOTICE_MS } from "./connection-status";

test("losing the connection shows the offline notice, whatever was shown before", () => {
  assert.equal(nextConnectionNotice(null, false), "offline");
  assert.equal(nextConnectionNotice("restored", false), "offline");
  assert.equal(nextConnectionNotice("offline", false), "offline");
});

test("the connection coming back is announced only after it was lost", () => {
  assert.equal(nextConnectionNotice("offline", true), "restored");
  assert.equal(nextConnectionNotice(null, true), null);
  // A second online event keeps the notice that is showing; it is not announced again.
  assert.equal(nextConnectionNotice("restored", true), "restored");
});

test("the notice that the connection is back is brief", () => {
  assert.ok(RESTORED_NOTICE_MS >= 2000 && RESTORED_NOTICE_MS <= 6000, `${RESTORED_NOTICE_MS} ms`);
});
