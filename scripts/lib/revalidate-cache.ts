import { parseEditorialCacheTags } from "../../src/lib/editorial-cache-tags";

function warnInvalidation(reason: string): false {
  console.warn(
    `WARNING: PostgreSQL was updated, but cache invalidation did not complete: ${reason} ` +
      "Cached content may remain until it expires. Retry invalidation when the endpoint is available.",
  );

  return false;
}

// Call only after a successful transaction/auto-commit. Failure must not undo or
// misreport the committed database write, and must never expose credentials.
export async function revalidateEditorialCache(requestedTags: string[]): Promise<boolean> {
  const tags = parseEditorialCacheTags({ tags: requestedTags });

  if (!tags) {
    return warnInvalidation("invalid editorial tags.");
  }

  const configuredUrl = process.env.CACHE_REVALIDATION_URL;
  const secret = process.env.CACHE_REVALIDATION_SECRET;

  if (!configuredUrl || !secret) {
    return warnInvalidation("configure CACHE_REVALIDATION_URL and CACHE_REVALIDATION_SECRET.");
  }

  let url: URL;

  try {
    url = new URL(configuredUrl);

    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return warnInvalidation(
        "CACHE_REVALIDATION_URL must be an HTTP(S) endpoint without credentials, query or fragment.",
      );
    }
  } catch {
    return warnInvalidation("invalid CACHE_REVALIDATION_URL.");
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });

    if (!response.ok) {
      return warnInvalidation(`endpoint returned HTTP ${response.status}.`);
    }

    const result: unknown = await response.json();
    const confirmedTags =
      typeof result === "object" && result !== null && "tags" in result
        ? parseEditorialCacheTags({ tags: result.tags })
        : null;

    if (
      typeof result !== "object" ||
      result === null ||
      !("revalidated" in result) ||
      result.revalidated !== true ||
      !confirmedTags ||
      confirmedTags.length !== tags.length ||
      tags.some((tag) => !confirmedTags.includes(tag))
    ) {
      return warnInvalidation("endpoint did not confirm the requested tags.");
    }

    console.log(`Editorial cache invalidated (${tags.length} tag(s)).`);

    return true;
  } catch {
    // Do not log fetch errors or response bodies: they can contain the secret.
    return warnInvalidation("endpoint unavailable, request timed out, or response was invalid.");
  }
}
