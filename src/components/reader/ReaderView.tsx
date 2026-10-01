"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiMinus, FiMoon, FiPlus, FiSun } from "react-icons/fi";
import { TbCoffee } from "react-icons/tb";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReaderPreferences } from "@/hooks/useReaderPreferences";
import {
  parseReadingProgress,
  readReadingProgress,
  saveReadingProgress,
  type ReadingProgress,
} from "@/lib/reading-progress";

type ReaderTheme = "light" | "sepia" | "dark";
type ReaderWidth = "narrow" | "medium" | "wide";

interface ReaderViewProps {
  bookSlug: string;
  bookTitle: string;
  author: string;

  chapterSlug: string;
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

export function ReaderView({
  bookSlug,
  bookTitle,
  author,
  chapterSlug,
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
  const progressStorageAvailable = useRef(true);
  const lastSavedPercentage = useRef<number | null>(null);
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

  const [progress, setProgress] = useState(0);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const article = articleRef.current;

    if (!article) {
      return;
    }

    hasRestoredProgress.current = false;
    progressStorageAvailable.current = true;

    const savedSnapshot = readReadingProgress(bookSlug);
    const parsedProgress = parseReadingProgress(savedSnapshot);
    const savedProgress = parsedProgress?.bookSlug === bookSlug ? parsedProgress : null;

    const savedPercentage =
      savedProgress?.chapterSlug === chapterSlug ? Math.min(100, Math.max(0, savedProgress.percentage)) : 0;

    setProgress(savedPercentage);
    lastSavedPercentage.current = savedProgress?.chapterSlug === chapterSlug ? savedPercentage : null;

    const progressStorageBlocked = savedSnapshot === null;

    if (progressStorageBlocked) {
      progressStorageAvailable.current = false;
    }

    const saveProgress = (percentage: number) => {
      if (!progressStorageAvailable.current) {
        return;
      }

      if (lastSavedPercentage.current === percentage) {
        return;
      }

      const readingProgress: ReadingProgress = {
        bookSlug,
        chapterSlug,
        chapterTitle,
        chapterNumber,
        chapterIndex,
        totalChapters,
        percentage,
        updatedAt: new Date().toISOString(),
      };

      if (!saveReadingProgress(readingProgress)) {
        progressStorageAvailable.current = false;
        setStorageError(true);
      } else {
        lastSavedPercentage.current = percentage;
      }
    };

    const calculateProgress = () => {
      const currentArticle = articleRef.current;

      if (!currentArticle) {
        return 0;
      }

      const articleTop = currentArticle.getBoundingClientRect().top + window.scrollY;

      const readableHeight = Math.max(currentArticle.offsetHeight - window.innerHeight, 1);

      const current = window.scrollY - articleTop;

      const percentage = Math.min(Math.max((current / readableHeight) * 100, 0), 100);

      return Math.round(percentage);
    };

    const updateProgress = () => {
      if (!hasRestoredProgress.current) {
        return;
      }

      const percentage = calculateProgress();

      setProgress(percentage);

      saveProgress(percentage);
    };

    let restoreScrollFrame = 0;
    const restoreFrame = requestAnimationFrame(() => {
      if (progressStorageBlocked) {
        setStorageError(true);
      }

      restoreScrollFrame = requestAnimationFrame(() => {
        const currentArticle = articleRef.current;

        if (!currentArticle) {
          hasRestoredProgress.current = true;

          return;
        }

        if (savedPercentage > 0) {
          const articleTop = currentArticle.getBoundingClientRect().top + window.scrollY;

          const readableHeight = Math.max(currentArticle.offsetHeight - window.innerHeight, 1);

          const targetScroll = articleTop + readableHeight * (savedPercentage / 100);

          hasRestoredProgress.current = true;

          window.scrollTo({
            top: targetScroll,
            behavior: "auto",
          });
        } else {
          hasRestoredProgress.current = true;

          saveProgress(0);
        }
      });
    });

    window.addEventListener("scroll", updateProgress, {
      passive: true,
    });

    return () => {
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(restoreScrollFrame);

      window.removeEventListener("scroll", updateProgress);
    };
  }, [bookSlug, chapterSlug, chapterTitle, chapterNumber, chapterIndex, totalChapters]);

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
            className="inline-flex items-center gap-2 text-sm opacity-60 transition hover:opacity-100"
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

            <Select value={width} onValueChange={changeWidth}>
              <SelectTrigger aria-label={t("readingWidth")} className="w-32 border-current/15 bg-transparent">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="narrow">{t("narrow")}</SelectItem>
                <SelectItem value="medium">{t("medium")}</SelectItem>
                <SelectItem value="wide">{t("wide")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <main className="px-6 pb-24">
        {(storageError || !preferencesAvailable) && (
          <p role="alert" className="mx-auto mt-6 max-w-3xl text-sm text-red-700">
            {t("storageUnavailable")}
          </p>
        )}

        <header className="mx-auto max-w-3xl py-12 text-center md:py-16">
          <p className="mb-3 text-xs tracking-[0.25em] uppercase opacity-50">{bookTitle}</p>

          <h1 className="font-serif text-4xl tracking-tight md:text-5xl">{chapterTitle}</h1>

          <p className="mt-4 text-sm opacity-50">{author}</p>
        </header>

        <article ref={articleRef} className={cn("mx-auto transition-all", widthClasses[width])} style={{ fontSize }}>
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
              <p className="text-xs opacity-50">{t("chapterOf", { current: chapterNumber, total: totalChapters })}</p>

              <p className="mt-1 text-xs opacity-40">{t("progress", { progress })}</p>
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
