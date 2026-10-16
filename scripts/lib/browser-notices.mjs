// Edge reports this intervention (Log.entryAdded, level "info") on pages whose images load lazily. It is a browser
// notice, not an application error, and Chrome does not emit it. The exact text is matched so that any other
// message, including another Edge notice, still fails the browser check.
export const EDGE_LAZY_IMAGE_NOTICE =
  "Images loaded lazily and replaced with placeholders. Load events are deferred. See https://go.microsoft.com/fwlink/?linkid=2048113";

/** @param {{ level?: string, text?: string } | null | undefined} entry A CDP `Log.entryAdded` entry. */
export function isBenignBrowserNotice(entry) {
  return entry?.level === "info" && entry.text === EDGE_LAZY_IMAGE_NOTICE;
}
