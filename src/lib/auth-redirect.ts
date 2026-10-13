export function safeAuthRedirect(next: string | null, origin: string): URL {
  const fallback = new URL("/es", origin);
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(next)) return fallback;
  try {
    const target = new URL(next, origin);
    // Validate after URL normalization (backslashes and dot segments matter).
    if (target.origin !== origin) return fallback;
    if (target.pathname === "/") return fallback;
    if (!/^\/(es|en)(?:\/|$)/.test(target.pathname)) return fallback;
    return target;
  } catch {
    return fallback;
  }
}
