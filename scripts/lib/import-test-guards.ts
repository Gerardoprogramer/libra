import { uploadCover } from "./r2";

// Guards for tests that run the importer: they must never reach the real cover upload, which writes to R2 with the
// R2_* settings of the environment. Imported by test files only.

export const R2_SETTINGS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
];

/**
 * Removes the R2 settings from this test process without reading them. An accidental call to the real uploadCover
 * then fails on its first setting, before any client is created or any request is sent.
 */
export function removeRealStorageSettings() {
  for (const name of R2_SETTINGS) delete process.env[name];
}

/** The importer dependencies of a test, refused unless they inject a test cover upload instead of the real one. */
export function testImportDependencies<T extends object>(dependencies: T): T {
  const cover = "uploadCover" in dependencies ? dependencies.uploadCover : undefined;
  if (typeof cover !== "function" || cover === uploadCover) {
    throw new Error("Importer tests must inject a test uploadCover: the real one writes to R2.");
  }
  return dependencies;
}
