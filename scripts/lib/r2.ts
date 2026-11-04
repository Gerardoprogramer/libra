import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { CUSTOM_COVER_PREFIX } from "./custom-cover";

export interface CoverKeyInput {
  bookSlug: string;
  gutenbergId: string;
  data: Buffer;
  extension: string;
  /** A cover made for Libra rather than taken from the EPUB: stored under covers/libra/ (see custom-cover.ts). */
  custom?: boolean;
}

interface UploadCoverInput extends CoverKeyInput {
  mediaType: string;
}

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not defined`);
  }

  return value;
}

/**
 * Deterministic object key: the same bytes always map to the same key, so a stored cover can be compared with
 * an EPUB cover without any request to R2, and re-uploading can never replace a different image.
 */
export function coverKeyFor({ bookSlug, gutenbergId, data, extension, custom = false }: CoverKeyInput): string {
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);

  return `${custom ? CUSTOM_COVER_PREFIX : "covers/"}${bookSlug}-${gutenbergId}-${hash}.${extension}`;
}

export async function uploadCover({ bookSlug, gutenbergId, data, mediaType, extension, custom }: UploadCoverInput) {
  const accountId = getEnv("R2_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  const bucketName = getEnv("R2_BUCKET_NAME");

  const publicUrl = new URL(getEnv("R2_PUBLIC_URL"));

  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new Error("R2_PUBLIC_URL must be an HTTPS URL without credentials, query or fragment.");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const key = coverKeyFor({ bookSlug, gutenbergId, data, extension, custom });

  try {
    // Keys are content-addressed and objects are never deleted here: an upload that is followed by a
    // rolled-back transaction leaves an unreferenced but harmless object, never a broken reference.
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: data,
        ContentType: mediaType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    return `${publicUrl.origin}${publicUrl.pathname.replace(/\/$/, "")}/${key}`;
  } finally {
    client.destroy();
  }
}
