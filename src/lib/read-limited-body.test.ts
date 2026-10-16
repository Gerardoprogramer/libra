import assert from "node:assert/strict";
import { test } from "node:test";

import { readLimitedBody } from "./read-limited-body";

const LIMIT = 4096;
const encoder = new TextEncoder();

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("https://libra.example/api/reading-progress", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

// A body with no declared length that keeps producing 1 KiB chunks and records how much was pulled from it.
function endlessStream() {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1024;
      controller.enqueue(new Uint8Array(1024).fill(0x20));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

test("a body of exactly the limit in bytes is read whole", async () => {
  const text = "a".repeat(LIMIT);
  assert.equal(await readLimitedBody(post(text), LIMIT), text);
});

test("one byte over the limit is refused", async () => {
  assert.equal(await readLimitedBody(post("a".repeat(LIMIT + 1)), LIMIT), null);
});

test("the limit counts UTF-8 bytes, not characters", async () => {
  // 2049 characters, 4098 bytes.
  const text = "é".repeat(LIMIT / 2 + 1);
  assert.ok(text.length <= LIMIT);
  assert.equal(await readLimitedBody(post(text), LIMIT), null);

  const fits = "é".repeat(LIMIT / 2);
  assert.equal(await readLimitedBody(post(fits), LIMIT), fits);
});

test("a body without Content-Length is cut off and cancelled once it passes the limit", async () => {
  const { stream, state } = endlessStream();
  const request = post(stream);
  assert.equal(request.headers.get("content-length"), null);

  assert.equal(await readLimitedBody(request, LIMIT), null);
  assert.ok(state.cancelled, "the rest of the stream is cancelled");
  // At most the limit plus the chunk that crossed it, and whatever the stream queued ahead of the reader.
  assert.ok(state.pulled <= LIMIT + 3 * 1024, `pulled ${state.pulled} bytes`);
});

test("a declared Content-Length over the limit is refused without reading the body", async () => {
  const { stream, state } = endlessStream();
  const pulledBefore = state.pulled;
  assert.equal(await readLimitedBody(post(stream, { "Content-Length": String(LIMIT + 1) }), LIMIT), null);
  assert.ok(state.cancelled);
  // The stream may pre-pull its first chunk on construction; the reader never asks for more.
  assert.ok(state.pulled <= pulledBefore + 1024);
});

test("an understated Content-Length does not let a larger body through", async () => {
  const { stream, state } = endlessStream();
  assert.equal(await readLimitedBody(post(stream, { "Content-Length": "10" }), LIMIT), null);
  assert.ok(state.cancelled);
});

test("an absent or empty body reads as the empty string", async () => {
  assert.equal(await readLimitedBody(new Request("https://libra.example/", { method: "POST" }), LIMIT), "");
  assert.equal(await readLimitedBody(post(""), LIMIT), "");
});

test("invalid UTF-8 and a failing stream reject instead of returning text", async () => {
  await assert.rejects(readLimitedBody(post(new Uint8Array([0x7b, 0xff, 0x7d])), LIMIT));

  const failing = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("{"));
      controller.error(new Error("connection reset"));
    },
  });
  await assert.rejects(readLimitedBody(post(failing), LIMIT), /connection reset/);
});
