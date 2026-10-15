function parseNext(next: string | null | undefined, origin: string): URL | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000- \u007f]/.test(next)) return null;
  try {
    const target = new URL(next, origin);
    // Validate after URL normalization (backslashes and dot segments matter).
    if (target.origin !== origin) return null;
    if (target.pathname === "/") return null;
    if (!/^\/(es|en)(?:\/|$)/.test(target.pathname)) return null;
    return target;
  } catch {
    return null;
  }
}

export function safeAuthRedirect(next: string | null, origin: string): URL {
  return parseNext(next, origin) ?? new URL("/es", origin);
}

/**
 * A same-origin, locale-prefixed path (with query and hash) that is safe to send a user to after signing in,
 * or null when `next` is absent or unacceptable, so the caller can use its own default.
 */
export function safeNextPath(next: string | null | undefined, origin: string): string | null {
  const target = parseNext(next, origin);

  return target ? `${target.pathname}${target.search}${target.hash}` : null;
}
