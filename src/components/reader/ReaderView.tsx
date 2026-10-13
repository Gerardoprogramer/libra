"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiMinus, FiMoon, FiPlus, FiSun } from "react-icons/fi";
import { TbCoffee } from "react-icons/tb";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReaderPreferences } from "@/hooks/useReaderPreferences";
import { createReadingSession } from "@/lib/reading-progress-session";
import { replayPendingReadingProgress } from "@/lib/reading-progress-sync";
import { useReadingProgressScope } from "@/lib/use-reading-progress-scope";

type ReaderTheme = "light" | "sepia" | "dark";
type ReaderWidth = "narrow" | "medium" | "wide";

interface ReaderViewProps {
  bookSlug: string;
  bookTitle: string;
  author: string;
  contentLanguage: string;

  editionId: string;
  chapterSlug: string;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  chapterIndex: number;

  totalChapters: number;
  children: ReactNode;

  previousHref?: string;
  nextHref?: string;
}

const themeClasses: Record<ReaderTheme, string> = {
  light: "bg-white text-zinc-900",
  sepia: "bg-[#f4ecd8] text-[#433422]",
  dark: "bg-[#161616] text-zinc-200",
};

const widthClasses: Record<ReaderWidth, string> = {
  narrow: "max-w-[560px]",
  medium: "max-w-[680px]",
  wide: "max-w-[820px]",
};

const optionThemeStyles: Record<ReaderTheme, CSSProperties> = {
  light: {
    backgroundColor: "#ffffff",
    color: "#18181b",
  },
  sepia: {
    backgroundColor: "#f4ecd8",
    color: "#433422",
  },
  dark: {
    backgroundColor: "#161616",
    color: "#e4e4e7",
  },
} satisfies Record<ReaderTheme, React.CSSProperties>;

function getCurrentParagraphIndex(article: HTMLElement): number {
  const paragraphs = Array.from(article.querySelectorAll<HTMLElement>("p"));

  if (paragraphs.length === 0) {
    return 0;
  }

  // Consideramos como "párrafo actual" el último que ya alcanzó
  // aproximadamente el primer tercio de la pantalla.
  const readingAnchor = window.scrollY + window.innerHeight * 0.35;

  let currentIndex = 0;

  for (let index = 0; index < paragraphs.length; index++) {
    const paragraphTop = paragraphs[index].getBoundingClientRect().top + window.scrollY;

    if (paragraphTop <= readingAnchor) {
      currentIndex = index;
    } else {
      break;
    }
  }

  return currentIndex;
}

function getParagraphScrollTop(article: HTMLElement, paragraphIndex: number): number | null {
  const paragraphs = Array.from(article.querySelectorAll<HTMLElement>("p"));

  if (paragraphs.length === 0) {
    return null;
  }

  const safeIndex = Math.min(Math.max(Math.floor(paragraphIndex), 0), paragraphs.length - 1);

  const paragraph = paragraphs[safeIndex];

  if (!paragraph) {
    return null;
  }

  const paragraphTop = paragraph.getBoundingClientRect().top + window.scrollY;

  return Math.max(0, paragraphTop - window.innerHeight * 0.35);
}

export function ReaderView({
  bookSlug,
  bookTitle,
  author,
  contentLanguage,
  editionId,
  chapterSlug,
  chapterId,
  chapterTitle,
  chapterNumber,
  chapterIndex,
  totalChapters,
  children,
  previousHref,
  nextHref,
}: ReaderViewProps) {
  const articleRef = useRef<HTMLElement>(null);
  const hasRestoredProgress = useRef(false);
  const lastSavedProgress = useRef<{
    percentage: number;
    paragraphIndex: number;
  } | null>(null);
  const {
    theme,
    width,
    fontSize,
    isAvailable: preferencesAvailable,
    setTheme,
    setWidth,
    setFontSize,
  } = useReaderPreferences();
  const t = useTranslations("reader");
  const scope = useReadingProgressScope();

  const [progress, setProgress] = useState(0);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !scope) return;
    let disposed = false;
    let userInteracted = false;
    let frame = 0;
    let restoreFrame = 0;
    let pendingPosition: { percentage: number; paragraphIndex: number } | null = null;
    hasRestoredProgress.current = false;
    lastSavedProgress.current = null;

    const session = createReadingSession(
      scope,
      {
        bookSlug,
        editionId,
        chapterId,
        chapterSlug,
        chapterTitle,
        chapterNumber,
        chapterIndex,
        totalChapters,
        contentLanguage,
      },
      (saved) => {
        cancelAnimationFrame(restoreFrame);
        restoreFrame = requestAnimationFrame(() => {
          if (disposed) return;
          setProgress(saved?.percentage ?? 0);
          lastSavedProgress.current = saved
            ? { percentage: saved.percentage, paragraphIndex: saved.paragraphIndex ?? 0 }
            : { percentage: 0, paragraphIndex: 0 };
          if (saved) {
            const top =
              typeof saved.paragraphIndex === "number"
                ? getParagraphScrollTop(article, saved.paragraphIndex)
                : article.getBoundingClientRect().top +
                  window.scrollY +
                  (Math.max(article.offsetHeight - window.innerHeight, 1) * saved.percentage) / 100;
            if (top !== null) window.scrollTo({ top, behavior: "auto" });
          }
          hasRestoredProgress.current = true;
        });
      },
      () => {
        if (!disposed) setStorageError(true);
      },
    );

    const measurePosition = () => {
      const articleTop = article.getBoundingClientRect().top + window.scrollY;
      const percentage = Math.round(
        Math.min(
          100,
          Math.max(0, ((window.scrollY - articleTop) / Math.max(article.offsetHeight - window.innerHeight, 1)) * 100),
        ),
      );
      const paragraphIndex = getCurrentParagraphIndex(article);
      return { percentage, paragraphIndex };
    };
    const recordPosition = (position = measurePosition()) => {
      if (disposed || !hasRestoredProgress.current) return;
      const { percentage, paragraphIndex } = position;
      setProgress(percentage);
      const previous = lastSavedProgress.current;
      if (previous?.percentage === percentage && previous.paragraphIndex === paragraphIndex) return;
      lastSavedProgress.current = { percentage, paragraphIndex };
      session.record(percentage, paragraphIndex);
    };
    const updateProgress = () => {
      // Restoring cached scroll must not masquerade as new user progress and
      // overwrite a newer cloud position before its response arrives.
      if (!userInteracted) return;
      pendingPosition = measurePosition();
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pendingPosition) recordPosition(pendingPosition);
        pendingPosition = null;
      });
    };
    const interact = () => {
      userInteracted = true;
      session.interact();
      cancelAnimationFrame(restoreFrame);
      hasRestoredProgress.current = true;
    };
    const flush = () => {
      if (userInteracted) recordPosition();
      session.flush();
    };
    const hide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const online = () => {
      replayPendingReadingProgress(scope);
    };
    void session.start();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("wheel", interact, { passive: true });
    window.addEventListener("touchstart", interact, { passive: true });
    window.addEventListener("pointerdown", interact, { passive: true });
    window.addEventListener("keydown", interact);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    return () => {
      // Capture a scroll whose animation frame has not run yet, then hand off
      // the outbox. DOM updates for the next route must not be measured here.
      if (pendingPosition) recordPosition(pendingPosition);
      disposed = true;
      session.dispose();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(restoreFrame);
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("wheel", interact);
      window.removeEventListener("touchstart", interact);
      window.removeEventListener("pointerdown", interact);
      window.removeEventListener("keydown", interact);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [
    scope,
    bookSlug,
    editionId,
    chapterId,
    chapterSlug,
    chapterTitle,
    chapterNumber,
    chapterIndex,
    totalChapters,
    contentLanguage,
  ]);

  function decreaseFontSize() {
    if (!setFontSize(fontSize - 2)) {
      setStorageError(true);
    }
  }

  function increaseFontSize() {
    if (!setFontSize(fontSize + 2)) {
      setStorageError(true);
    }
  }

  function changeTheme(nextTheme: ReaderTheme) {
    if (!setTheme(nextTheme)) {
      setStorageError(true);
    }
  }

  function changeWidth(nextWidth: string | undefined) {
    if (nextWidth !== "narrow" && nextWidth !== "medium" && nextWidth !== "wide") {
      return;
    }

    if (!setWidth(nextWidth)) {
      setStorageError(true);
    }
  }

  return (
    <div className={cn("min-h-screen transition-colors duration-300", themeClasses[theme])}>
      <div aria-hidden="true" className="sticky top-16 z-40 h-1 bg-current/10">
        <div className="h-full bg-current transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col gap-5 border-b border-current/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <Link
            href={`/books/${bookSlug}`}
            className="inline-flex items-center gap-2 text-sm text-current/75 transition hover:text-current"
          >
            <FiArrowLeft aria-hidden="true" />
            {bookTitle}
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-current/15 p-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("lightTheme")}
                onClick={() => changeTheme("light")}
                className={cn(theme === "light" && "bg-current/10")}
              >
                <FiSun aria-hidden="true" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                aria-label={t("sepiaTheme")}
                onClick={() => changeTheme("sepia")}
                className={cn(theme === "sepia" && "bg-current/10")}
              >
                <TbCoffee aria-hidden="true" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                aria-label={t("darkTheme")}
                onClick={() => changeTheme("dark")}
                className={cn(theme === "dark" && "bg-current/10")}
              >
                <FiMoon aria-hidden="true" />
              </Button>
            </div>

            <div className="flex items-center rounded-lg border border-current/15 p-1">
              <Button size="icon" variant="ghost" aria-label={t("decreaseTextSize")} onClick={decreaseFontSize}>
                <FiMinus aria-hidden="true" />
              </Button>

              <span aria-live="polite" className="w-10 text-center text-sm">
                {fontSize}
              </span>

              <Button size="icon" variant="ghost" aria-label={t("increaseTextSize")} onClick={increaseFontSize}>
                <FiPlus aria-hidden="true" />
              </Button>
            </div>

            <select
              value={width}
              onChange={(event) => changeWidth(event.target.value)}
              aria-label={t("readingWidth")}
              className="h-9 w-32 rounded-lg border border-current/15 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-current/30"
              style={{
                colorScheme: theme === "dark" ? "dark" : "light",
              }}
            >
              <option value="narrow" style={optionThemeStyles[theme]}>
                {t("narrow")}
              </option>

              <option value="medium" style={optionThemeStyles[theme]}>
                {t("medium")}
              </option>

              <option value="wide" style={optionThemeStyles[theme]}>
                {t("wide")}
              </option>
            </select>
          </div>
        </div>
      </div>

      <main className="px-6 pb-24">
        {(storageError || !preferencesAvailable) && (
          <p role="alert" className="mx-auto mt-6 max-w-3xl text-sm text-red-700">
            {t("storageUnavailable")}
          </p>
        )}

        <header lang={contentLanguage} className="mx-auto max-w-3xl py-12 text-center md:py-16">
          <p className="mb-3 text-xs tracking-[0.25em] text-current/75 uppercase">{bookTitle}</p>

          <h1 className="font-serif text-4xl tracking-tight md:text-5xl">{chapterTitle}</h1>

          <p className="mt-4 text-sm text-current/75">{author}</p>
        </header>

        <article
          ref={articleRef}
          lang={contentLanguage}
          className={cn("mx-auto", widthClasses[width])}
          style={{ fontSize }}
        >
          {children}
        </article>

        <footer className={cn("mx-auto mt-20 border-t border-current/10 pt-8", widthClasses[width])}>
          <div className="flex items-center justify-between gap-4">
            {previousHref ? (
              <Button variant="outline" asChild>
                <Link href={previousHref}>
                  <FiChevronLeft aria-hidden="true" />
                  {t("previous")}
                </Link>
              </Button>
            ) : (
              <div />
            )}

            <div className="text-center">
              <p className="text-xs text-current/75">
                {t("chapterOf", { current: chapterNumber, total: totalChapters })}
              </p>

              <p className="mt-1 text-xs text-current/75">{t("progress", { progress })}</p>
            </div>

            {nextHref ? (
              <Button asChild>
                <Link href={nextHref}>
                  {t("next")}
                  <FiChevronRight aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href={`/books/${bookSlug}`}>{t("finish")}</Link>
              </Button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
