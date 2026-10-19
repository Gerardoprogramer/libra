"use client";

import { useLocale } from "next-intl";
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useEffect, useRef, useState, type RefObject } from "react";

import { getPathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
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

/**
 * Prefetches the next chapter once the reader is near the end of this one: when the chapter's footer comes within a
 * screen of the viewport, or the reading progress reaches NEXT_CHAPTER_PREFETCH_PROGRESS. `nextHref` is the same
 * href the "Next" link uses, so the navigation reuses the prefetched route. Nothing runs during server rendering.
 */
export function usePrefetchNextChapter(
  nextHref: string | undefined,
  progress: number,
  footerRef: RefObject<HTMLElement | null>,
) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  // Kept while Activity hides and shows the chapter again, so a chapter prefetches its next one only once.
  const [prefetcher] = useState(createNextChapterPrefetcher);
  const reading = useRef({ progress, footerNear: false });
  const evaluate = useRef(() => {});

  useEffect(() => {
    if (!nextHref) return;

    // The localized URL the link navigates to: a change of language or edition is a different prefetch.
    const target = getPathname({ href: nextHref, locale });
    const connection = (navigator as Navigator & { connection?: NetworkInformationTarget }).connection;

    const run = () => {
      prefetcher.update(
        {
          nextHref: target,
          progress: reading.current.progress,
          footerNear: reading.current.footerNear,
          ...readNetworkConditions({ onLine: navigator.onLine, connection }),
        },
        (onInvalidate) => router.prefetch(nextHref, { kind: FULL_PREFETCH, onInvalidate }),
      );
    };

    evaluate.current = run;

    const footer = footerRef.current;
    const observer =
      footer && typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              // One notification can hold several changes of the footer, oldest first: the last one is current.
              const entry = entries[entries.length - 1];
              reading.current.footerNear = entry?.isIntersecting ?? false;
              run();
            },
            { rootMargin: NEXT_CHAPTER_FOOTER_MARGIN },
          )
        : null;

    if (footer) observer?.observe(footer);
    window.addEventListener("online", run);
    connection?.addEventListener?.("change", run);
    run();

    return () => {
      evaluate.current = () => {};
      observer?.disconnect();
      window.removeEventListener("online", run);
      connection?.removeEventListener?.("change", run);
      prefetcher.release();
    };
  }, [nextHref, locale, router, footerRef, prefetcher]);

  useEffect(() => {
    reading.current.progress = progress;
    evaluate.current();
  }, [progress]);
}
