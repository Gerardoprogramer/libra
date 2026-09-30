const editorialTagPattern =
  /^(?:book:[a-z0-9]+(?:-[a-z0-9]+)*|chapter:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function parseEditorialCacheTags(payload: unknown): string[] | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !("tags" in payload) ||
    !Array.isArray(payload.tags) ||
    payload.tags.length === 0 ||
    payload.tags.length > 50
  ) {
    return null;
  }

  const tags: string[] = [];

  for (const tag of payload.tags) {
    if (
      typeof tag !== "string" ||
      tag.length > 256 ||
      (tag !== "library" && tag !== "library:editorial" && !editorialTagPattern.test(tag))
    ) {
      return null;
    }

    // Keep the existing cacheTag declarations; "library" is the public alias.
    tags.push(tag === "library" ? "library:editorial" : tag);
  }

  return [...new Set(tags)];
}
