// When the reader prefetches the whole next chapter (text included), so that following "Next" renders it without the
// chapter's loading placeholder. Only near the end of a chapter, where a click is likely soon, and never on a
// connection the reader has asked to spare or that could not finish it in time.

/** Chapter progress (0–100) from which the next chapter is prefetched. */
export const NEXT_CHAPTER_PREFETCH_PROGRESS = 75;

/** IntersectionObserver margin: the chapter's footer counts as near within one screen below the viewport. */
export const NEXT_CHAPTER_FOOTER_MARGIN = "0px 0px 100% 0px";

const SLOW_CONNECTIONS = new Set(["slow-2g", "2g"]);

export interface NetworkConditions {
  online: boolean;
  /** The Network Information API's data saver flag; false where the API is missing. */
  saveData: boolean;
  /** The Network Information API's estimate ("slow-2g", "2g", "3g", "4g"); undefined where the API is missing. */
  effectiveType?: string;
}

export interface NextChapterPrefetchInput extends NetworkConditions {
  /** The next chapter's URL, exactly as its link navigates to it; undefined in the last chapter. */
  nextHref: string | undefined;
  progress: number;
  footerNear: boolean;
  /** The URL this chapter already prefetched, if any. */
  prefetchedHref: string | null;
}

export function shouldPrefetchNextChapter({
  nextHref,
  progress,
  footerNear,
  prefetchedHref,
  online,
  saveData,
  effectiveType,
}: NextChapterPrefetchInput): boolean {
  if (!nextHref || nextHref === prefetchedHref) return false;
  if (!online || saveData || (effectiveType !== undefined && SLOW_CONNECTIONS.has(effectiveType))) return false;

  return footerNear || progress >= NEXT_CHAPTER_PREFETCH_PROGRESS;
}

interface NavigatorLike {
  onLine: boolean;
  connection?: { saveData?: boolean; effectiveType?: string };
}

export function readNetworkConditions(navigator: NavigatorLike): NetworkConditions {
  return {
    online: navigator.onLine,
    saveData: navigator.connection?.saveData === true,
    effectiveType: navigator.connection?.effectiveType,
  };
}

export type NextChapterPrefetchState = Omit<NextChapterPrefetchInput, "prefetchedHref">;

/**
 * One chapter's prefetch: at most one request per next-chapter URL, plus a single refresh when the router reports
 * that the prefetched data may be stale. A prefetch that fails is never retried: the link then navigates as it
 * always has, through the loading placeholder.
 */
export function createNextChapterPrefetcher() {
  let prefetchedHref: string | null = null;
  let refreshedHref: string | null = null;
  let latest: { state: NextChapterPrefetchState; prefetch: (onInvalidate: () => void) => void } | null = null;

  function update(state: NextChapterPrefetchState, prefetch: (onInvalidate: () => void) => void): boolean {
    latest = { state, prefetch };
    const href = state.nextHref;

    if (!href || !shouldPrefetchNextChapter({ ...state, prefetchedHref })) return false;

    prefetchedHref = href;

    const onInvalidate = () => {
      if (prefetchedHref !== href || refreshedHref === href) return;
      refreshedHref = href;
      prefetchedHref = null;
      if (latest) update(latest.state, latest.prefetch);
    };

    try {
      prefetch(onInvalidate);
    } catch {
      // The link still navigates as before; the URL stays marked, so it is not retried.
    }

    return true;
  }

  return {
    update,
    /** Stops a later invalidation from prefetching again once the chapter is no longer shown. */
    release() {
      latest = null;
    },
  };
}
