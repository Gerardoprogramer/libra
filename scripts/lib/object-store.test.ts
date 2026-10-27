import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  ensureStoredImage,
  ILLUSTRATION_CACHE_CONTROL,
  illustrationKey,
  ObjectStoreError,
  storeImages,
  type StorableImage,
} from "./object-store";
import { MemoryObjectStore } from "./object-store-fixtures";

// Storing normalized images: an object is uploaded only when absent, every object is read back and hashed before the
// database may reference it, and an object with other content is never overwritten. In memory only.

function image(text = "normalized bytes", mediaType = "image/png"): StorableImage {
  const data = Buffer.from(text);
  return {
    key: illustrationKey(data, mediaType),
    sha256: createHash("sha256").update(data).digest("hex"),
    mediaType,
    bytes: data.length,
    data,
  };
}

const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ObjectStoreError, String(error));
    assert.match(error.message, pattern);
    return true;
  });

test("the key is the SHA-256 of the normalized bytes with the extension of their format", () => {
  const png = image("x");
  assert.equal(png.key, `illustrations/${png.sha256}.png`);
  assert.match(image("x", "image/jpeg").key, /\.jpg$/);
  assert.match(image("x", "image/webp").key, /\.webp$/);
  assert.throws(() => illustrationKey(Buffer.from("x"), "image/gif"), /no key/);
});

test("an absent object is uploaded with its type and immutable caching, then read back and verified", async () => {
  const store = new MemoryObjectStore();
  const png = image();
  assert.equal(await ensureStoredImage(store, png), "uploaded");
  const stored = store.objects.get(png.key);
  assert.ok(stored?.data.equals(png.data));
  assert.equal(stored?.contentType, "image/png");
  assert.equal(stored?.cacheControl, ILLUSTRATION_CACHE_CONTROL);
  assert.deepEqual(store.calls, [`head ${png.key}`, `put ${png.key}`, `head ${png.key}`, `get ${png.key}`]);
});

test("an existing object with exactly these bytes is reused without uploading, after reading it back", async () => {
  const store = new MemoryObjectStore();
  const png = image();
  store.objects.set(png.key, { data: Buffer.from(png.data), contentType: "image/png", cacheControl: "" });
  assert.equal(await ensureStoredImage(store, png), "verified-existing");
  assert.deepEqual(store.calls, [`head ${png.key}`, `get ${png.key}`]);
});

test("an existing object with other content, size or type blocks the import and is never overwritten", async () => {
  const png = image("abcdef");
  for (const [stored, contentType, pattern] of [
    [Buffer.from("abcdeX"), "image/png", /stored SHA-256 [0-9a-f]{64}, expected/],
    [Buffer.from("abc"), "image/png", /stored size 3, expected 6/],
    [Buffer.from("abcdef"), "image/jpeg", /stored type image\/jpeg, expected image\/png/],
  ] as const) {
    const store = new MemoryObjectStore();
    store.objects.set(png.key, { data: Buffer.from(stored), contentType, cacheControl: "" });
    await rejects(
      ensureStoredImage(store, png),
      new RegExp(`already exists with other content[\\s\\S]*${pattern.source}`),
    );
    assert.ok(store.objects.get(png.key)?.data.equals(stored), "left as it was");
    assert.ok(!store.calls.some((call) => call.startsWith("put")));
  }
});

test("failed, lost or damaged uploads and failed reads never pass as stored", async () => {
  const png = image();

  const failing = new MemoryObjectStore();
  failing.fail.put.add(png.key);
  await assert.rejects(ensureStoredImage(failing, png), /simulated put failure/);
  assert.equal(failing.objects.size, 0);

  const losing = new MemoryObjectStore();
  losing.lose.add(png.key);
  await rejects(ensureStoredImage(losing, png), /not found after the upload/);

  const damaging = new MemoryObjectStore();
  damaging.damage.add(png.key);
  await rejects(ensureStoredImage(damaging, png), /failed verification after the upload \(stored SHA-256/);

  const unreadable = new MemoryObjectStore();
  unreadable.fail.get.add(png.key);
  await assert.rejects(ensureStoredImage(unreadable, png), /simulated get failure/);

  const unlisted = new MemoryObjectStore();
  unlisted.fail.head.add("*");
  await assert.rejects(ensureStoredImage(unlisted, png), /simulated head failure/);
});

test("bytes that are not what the plan recorded are refused before anything is sent", async () => {
  const store = new MemoryObjectStore();
  const png = image();
  await rejects(ensureStoredImage(store, { ...png, data: Buffer.from("other") }), /do not match their recorded/);
  await rejects(ensureStoredImage(store, { ...png, key: "illustrations/x.png" }), /key is not the SHA-256/);
  assert.deepEqual(store.calls, []);
});

test("identical bytes under several paths are stored and verified once; a retry verifies and reuses them", async () => {
  const store = new MemoryObjectStore();
  const png = image();
  const jpeg = image("other", "image/jpeg");
  const first = await storeImages(store, [png, png, jpeg]);
  assert.deepEqual(
    [...first.entries()],
    [
      [png.key, "uploaded"],
      [jpeg.key, "uploaded"],
    ],
  );
  const retry = await storeImages(store, [png, jpeg]);
  assert.deepEqual([...retry.values()], ["verified-existing", "verified-existing"]);
  assert.equal(store.calls.filter((call) => call.startsWith("put")).length, 2);
});
