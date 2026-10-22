export type ConnectionNotice = "offline" | "restored" | null;

/** How long the notice that the connection is back stays on screen. */
export const RESTORED_NOTICE_MS = 4000;

/**
 * The notice to show after the browser reports the connection as lost or back. "restored" only follows "offline", so
 * a page that was always online never announces anything, and a repeated event keeps the notice as it is.
 */
export function nextConnectionNotice(current: ConnectionNotice, online: boolean): ConnectionNotice {
  if (!online) return "offline";

  return current === "offline" ? "restored" : current;
}
