"use client";

import { useLocale } from "next-intl";
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useEffect, useState, type FocusEvent, type RefObject } from "react";

import { getPathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  canPrefetchOnConnection,
  createNextChapterPrefetcher,
  NEXT_CHAPTER_FOOTER_MARGIN,
  readNetworkConditions,
} from "@/lib/next-chapter-prefetch";

// router.prefetch() defaults to "auto", which with Cache Components stops at the chapter's loading.tsx, as the links
// do. "full" also brings the chapter itself, like <Link prefetch={true}>. Next.js does not export the enum publicly.
const FULL_PREFETCH = "full" as PrefetchKind;

interface NetworkInformationTarget extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}

function getConnection() {
  return (navigator as Navigator & { connection?: NetworkInformationTarget }).connection;
}

function currentNetworkConditions() {
  return readNetworkConditions({ onLine: navigator.onLine, connection: getConnection() });
}

/** Whether an element has keyboard focus. A browser without :focus-visible (Safari before 15.4) counts as no. */
export function hasKeyboardFocus(element: Pick<Element, "matches">): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * Prefetches the next chapter once the chapter's footer comes within a screen of the viewport. `nextHref` is the same
 * href the "Next" link uses, so the navigation reuses the prefetched route. Next.js considers it stale after about 30
 * seconds and does not renew it, so the "Next" link takes over with a full prefetch of its own (`linkPrefetch`): when
 * it scrolls into view and on hover or touch, Next.js fetches it again only if it is missing or stale; a request still
 * in flight is shared, not repeated. `onLinkFocus` does the same for keyboard focus. On a connection that does not
 * allow it the link keeps its default prefetch, which stops at the loading placeholder. Nothing runs on the server.
 */
export function usePrefetchNextChapter(nextHref: string | undefined, footerRef: RefObject<HTMLElement | null>) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  // Kept while Activity hides and shows the chapter again, so a chapter prefetches its next one only once.
  const [prefetcher] = useState(createNextChapterPrefetcher);
  // False on the server and during hydration, so both render the link's default prefetch.
  const [connectionAllows, setConnectionAllows] = useState(false);

  useEffect(() => {
    const connection = getConnection();
    const update = () => setConnectionAllows(canPrefetchOnConnection(currentNetworkConditions()));

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    connection?.addEventListener?.("change", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      connection?.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    if (!nextHref) return;

    // The localized URL the link navigates to: a change of language or edition is a different prefetch.
    const target = getPathname({ href: nextHref, locale });
    const connection = getConnection();
    let footerNear = false;

    const run = () => {
      prefetcher.update({ nextHref: target, footerNear, ...currentNetworkConditions() }, (onInvalidate) =>
        router.prefetch(nextHref, { kind: FULL_PREFETCH, onInvalidate }),
      );
    };

    const footer = footerRef.current;
    // Without IntersectionObserver the link's own prefetch still applies.
    const observer =
      footer && typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              // One notification can hold several changes of the footer, oldest first: the last one is current.
              const entry = entries[entries.length - 1];
              footerNear = entry?.isIntersecting ?? false;
              run();
            },
            { rootMargin: NEXT_CHAPTER_FOOTER_MARGIN },
          )
        : null;

    if (footer) observer?.observe(footer);
    window.addEventListener("online", run);
    connection?.addEventListener?.("change", run);

    return () => {
      observer?.disconnect();
      window.removeEventListener("online", run);
      connection?.removeEventListener?.("change", run);
      prefetcher.release();
    };
  }, [nextHref, locale, router, footerRef, prefetcher]);

  function onLinkFocus(event: FocusEvent<HTMLElement>) {
    // Keyboard focus only: a click focuses the link just before it navigates, which needs no prefetch of its own.
    if (!nextHref || !hasKeyboardFocus(event.currentTarget)) return;
    if (!canPrefetchOnConnection(currentNetworkConditions())) return;

    try {
      router.prefetch(nextHref, { kind: FULL_PREFETCH });
    } catch {
      // The link still navigates as before.
    }
  }

  return { linkPrefetch: connectionAllows ? (true as const) : ("auto" as const), onLinkFocus };
}
