import { createHash } from "node:crypto";

import { IMAGE_FORMATS } from "./epub-images";

// Where normalized illustrations are stored, and the check that a stored object is exactly the image the database
// will point at. The importer never writes a row for an object it has not verified: a row in image_assets says the
// object was verified once, in some bucket, not that it is present in this one now, so every object is verified again
// by every import that uses it. Verification never trusts the store's own fingerprints (an ETag is not a SHA-256):
// the object is read back and hashed here.
//
// No store is implemented here; tests use the in-memory one in object-store-fixtures.ts. A store backed by a real
// bucket must also prove which bucket and environment it writes to before an import may use it; that check, and
// enabling such a store, are separate, reviewed work.

export interface ObjectHead {
  size: number;
  contentType: string | null;
}

export interface ObjectStore {
  /** What the store writes to, for messages; never a credential. */
  readonly description: string;
  /** The object's size and type, or null when it does not exist. */
  head(key: string): Promise<ObjectHead | null>;
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer, options: { contentType: string; cacheControl: string }): Promise<void>;
}

/** Keys are content-addressed, so an object never changes: cached for a year, immutable. */
export const ILLUSTRATION_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** A normalized image to store: its bytes and what they must be. */
export interface StorableImage {
  key: string;
  sha256: string;
  mediaType: string;
  bytes: number;
  data: Buffer;
}

export class ObjectStoreError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(`Object ${key}: ${message}. Nothing was written to the database.`);
    this.name = "ObjectStoreError";
  }
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The key of normalized bytes: their SHA-256 and the extension of their format. */
export function illustrationKey(data: Buffer, mediaType: string) {
  const format = Object.values(IMAGE_FORMATS).find((item) => item.mediaType === mediaType);
  if (!format) throw new Error(`no key for media type ${mediaType}`);
  return `illustrations/${sha256(data)}.${format.extension}`;
}

/** Why the stored object is not `image`, or null when its size, type and bytes (hashed here) all match. */
async function mismatch(store: ObjectStore, image: StorableImage, head: ObjectHead): Promise<string | null> {
  if (head.size !== image.bytes) return `stored size ${head.size}, expected ${image.bytes}`;
  if (head.contentType !== image.mediaType) return `stored type ${head.contentType}, expected ${image.mediaType}`;
  const data = await store.get(image.key);
  if (!data) return "listed but its bytes cannot be read";
  if (data.length !== image.bytes) return `read ${data.length} bytes, expected ${image.bytes}`;
  const digest = sha256(data);
  return digest === image.sha256 ? null : `stored SHA-256 ${digest}, expected ${image.sha256}`;
}

/**
 * Makes sure `image` is stored under its key and verified, uploading it only when absent. An existing object that is
 * not exactly these bytes (size, type or SHA-256) stops the import: it is never overwritten. Any store error
 * propagates; the database is only written after every image of the import came back from here.
 */
export async function ensureStoredImage(
  store: ObjectStore,
  image: StorableImage,
): Promise<"verified-existing" | "uploaded"> {
  // The bytes are what the plan says before anything is sent.
  if (image.data.length !== image.bytes || sha256(image.data) !== image.sha256) {
    throw new ObjectStoreError(image.key, "the normalized bytes do not match their recorded size and SHA-256");
  }
  if (illustrationKey(image.data, image.mediaType) !== image.key) {
    throw new ObjectStoreError(image.key, "the key is not the SHA-256 and format of the bytes");
  }

  const existing = await store.head(image.key);
  if (existing) {
    const problem = await mismatch(store, image, existing);
    if (problem)
      throw new ObjectStoreError(image.key, `already exists with other content (${problem}); not overwritten`);
    return "verified-existing";
  }

  await store.put(image.key, image.data, { contentType: image.mediaType, cacheControl: ILLUSTRATION_CACHE_CONTROL });
  const uploaded = await store.head(image.key);
  if (!uploaded) throw new ObjectStoreError(image.key, "not found after the upload");
  const problem = await mismatch(store, image, uploaded);
  if (problem) throw new ObjectStoreError(image.key, `failed verification after the upload (${problem})`);
  return "uploaded";
}

/**
 * Stores and verifies every image (one object per key, so identical bytes under two paths are stored once), outside
 * any database transaction. Returns the keys verified now: the only ones the write may reference.
 */
export async function storeImages(store: ObjectStore, images: readonly StorableImage[]) {
  const verified = new Map<string, "verified-existing" | "uploaded">();
  for (const image of images) {
    if (verified.has(image.key)) continue;
    verified.set(image.key, await ensureStoredImage(store, image));
  }
  return verified;
}
