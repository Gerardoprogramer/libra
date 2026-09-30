import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

interface UploadCoverInput {
  bookSlug: string;
  gutenbergId: string;
  data: Buffer;
  mediaType: string;
  extension: string;
}

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not defined`);
  }

  return value;
}

export async function uploadCover({ bookSlug, gutenbergId, data, mediaType, extension }: UploadCoverInput) {
  const accountId = getEnv("R2_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  const bucketName = getEnv("R2_BUCKET_NAME");

  const publicUrl = getEnv("R2_PUBLIC_URL").replace(/\/$/, "");

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);

  const key = `covers/${bookSlug}-${gutenbergId}-${hash}.${extension}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: data,
      ContentType: mediaType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return `${publicUrl}/${key}`;
}
