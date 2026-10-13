"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiMinus, FiMoon, FiPlus, FiSun } from "react-icons/fi";
import { TbCoffee } from "react-icons/tb";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReaderPreferences } from "@/hooks/useReaderPreferences";
import {
  parseReadingProgress,
  readReadingProgress,
  saveReadingProgress,
  type ReadingProgress,
} from "@/lib/reading-progress";
import {
  getAuthenticatedUserId,
  getCloudReadingProgress,
  saveCloudReadingProgress,
} from "@/lib/reading-progress-cloud";

type ReaderTheme = "light" | "sepia" | "dark";
type ReaderWidth = "narrow" | "medium" | "wide";

interface ReaderChapterRoute {
  id: string;
  slug: string;
}

interface ReaderViewProps {
  bookSlug: string;
  bookTitle: string;
  author: string;
  contentLanguage: string;

  editionId: string;
  chapterSlug: string;
  chapterId: string;
  chapterTitle: string;
  chapterRoutes: ReaderChapterRoute[];
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
  chapterRoutes,
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
  const router = useRouter();

  const [progress, setProgress] = useState(0);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const article = articleRef.current;

    if (!article) {
      return;
    }

    let disposed = false;

    let cloudSyncEnabled = false;

    let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;

    let pendingCloudProgress: ReadingProgress | null = null;

    let cloudSaveInFlight = false;

    let progressFrame = 0;

    let restoreScrollFrame = 0;

    let effectiveProgress: ReadingProgress | null = null;

    hasRestoredProgress.current = false;
    progressStorageAvailable.current = true;

    const savedSnapshot = readReadingProgress(bookSlug);

    const parsedProgress = parseReadingProgress(savedSnapshot);

    const localProgress = parsedProgress?.bookSlug === bookSlug ? parsedProgress : null;

    const localCurrentProgress = localProgress?.chapterSlug === chapterSlug ? localProgress : null;

    effectiveProgress = localCurrentProgress;

    const progressStorageBlocked = savedSnapshot === null;

    if (progressStorageBlocked) {
      progressStorageAvailable.current = false;
    }

    setProgress(localCurrentProgress?.percentage ?? 0);

    lastSavedProgress.current = localCurrentProgress
      ? {
          percentage: localCurrentProgress.percentage,
          paragraphIndex: localCurrentProgress.paragraphIndex ?? 0,
        }
      : null;

    const persistLocalProgress = (readingProgress: ReadingProgress) => {
      if (!progressStorageAvailable.current) {
        return false;
      }

      if (!saveReadingProgress(readingProgress)) {
        progressStorageAvailable.current = false;
        setStorageError(true);

        return false;
      }

      lastSavedProgress.current = {
        percentage: readingProgress.percentage,
        paragraphIndex: readingProgress.paragraphIndex ?? 0,
      };

      return true;
    };

    const buildCloudInput = (readingProgress: ReadingProgress) => {
      if (readingProgress.editionId && readingProgress.editionId !== editionId) {
        return null;
      }

      const targetChapterId =
        readingProgress.chapterId ?? (readingProgress.chapterSlug === chapterSlug ? chapterId : null);

      if (!targetChapterId) {
        return null;
      }

      return {
        editionId,
        chapterId: targetChapterId,
        paragraphIndex: Math.max(0, Math.floor(readingProgress.paragraphIndex ?? 0)),
        percentage: Math.min(100, Math.max(0, Math.round(readingProgress.percentage))),
        updatedAt: readingProgress.updatedAt,
      };
    };

    const createLocalProgressFromCloud = (cloudProgress: {
      paragraph_index: number;
      percentage: number;
      updated_at: string;
    }): ReadingProgress => {
      return {
        bookSlug,
        editionId,
        chapterSlug,
        chapterId,
        chapterTitle,
        chapterNumber,
        chapterIndex,
        totalChapters,
        paragraphIndex: Math.max(0, Math.floor(cloudProgress.paragraph_index)),
        percentage: Math.min(100, Math.max(0, Math.round(cloudProgress.percentage))),
        updatedAt: cloudProgress.updated_at,
      };
    };

    const flushCloudSave = async () => {
      if (disposed || !cloudSyncEnabled || cloudSaveInFlight || !pendingCloudProgress) {
        return;
      }

      const progressToSave = pendingCloudProgress;

      pendingCloudProgress = null;

      const cloudInput = buildCloudInput(progressToSave);

      if (!cloudInput) {
        return;
      }

      cloudSaveInFlight = true;

      try {
        const cloudProgress = await saveCloudReadingProgress(cloudInput);

        if (disposed) {
          return;
        }

        const syncedLocalProgress: ReadingProgress = {
          ...progressToSave,
          editionId: cloudInput.editionId,
          chapterId: cloudInput.chapterId,
          paragraphIndex: cloudInput.paragraphIndex,
          percentage: cloudInput.percentage,
          updatedAt: cloudProgress.updated_at,
        };

        persistLocalProgress(syncedLocalProgress);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Libra: failed to synchronize reading progress.", error);
        }
      } finally {
        cloudSaveInFlight = false;

        if (!disposed && pendingCloudProgress) {
          cloudSaveTimer = setTimeout(() => {
            cloudSaveTimer = null;
            void flushCloudSave();
          }, 250);
        }
      }
    };

    const queueCloudSave = (readingProgress: ReadingProgress) => {
      if (!cloudSyncEnabled) {
        return;
      }

      pendingCloudProgress = readingProgress;

      if (cloudSaveTimer !== null) {
        clearTimeout(cloudSaveTimer);
      }

      cloudSaveTimer = setTimeout(() => {
        cloudSaveTimer = null;
        void flushCloudSave();
      }, 1200);
    };

    const saveProgress = (percentage: number, paragraphIndex: number) => {
      const readingProgress: ReadingProgress = {
        bookSlug,
        editionId,
        chapterSlug,
        chapterId,
        chapterTitle,
        chapterNumber,
        chapterIndex,
        totalChapters,
        paragraphIndex,
        percentage,
        updatedAt: new Date().toISOString(),
      };

      persistLocalProgress(readingProgress);

      queueCloudSave(readingProgress);
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
      if (progressFrame) {
        return;
      }

      progressFrame = requestAnimationFrame(() => {
        progressFrame = 0;

        if (!hasRestoredProgress.current) {
          return;
        }

        const currentArticle = articleRef.current;

        if (!currentArticle) {
          return;
        }

        const percentage = calculateProgress();

        const paragraphIndex = getCurrentParagraphIndex(currentArticle);

        setProgress((current) => (current === percentage ? current : percentage));

        const previous = lastSavedProgress.current;

        if (previous?.percentage === percentage && previous?.paragraphIndex === paragraphIndex) {
          return;
        }

        saveProgress(percentage, paragraphIndex);
      });
    };

    const restoreProgress = () => {
      if (disposed) {
        return;
      }

      if (progressStorageBlocked) {
        setStorageError(true);
      }

      restoreScrollFrame = requestAnimationFrame(() => {
        if (disposed) {
          return;
        }

        const currentArticle = articleRef.current;

        if (!currentArticle) {
          hasRestoredProgress.current = true;
          return;
        }

        if (!effectiveProgress) {
          hasRestoredProgress.current = true;
          return;
        }

        const savedParagraphIndex = effectiveProgress.paragraphIndex;

        if (typeof savedParagraphIndex === "number") {
          const paragraphScrollTop = getParagraphScrollTop(currentArticle, savedParagraphIndex);

          if (paragraphScrollTop !== null) {
            hasRestoredProgress.current = true;

            window.scrollTo({
              top: paragraphScrollTop,
              behavior: "auto",
            });

            return;
          }
        }

        if (effectiveProgress.percentage > 0) {
          const articleTop = currentArticle.getBoundingClientRect().top + window.scrollY;

          const readableHeight = Math.max(currentArticle.offsetHeight - window.innerHeight, 1);

          const targetScroll = articleTop + readableHeight * (effectiveProgress.percentage / 100);

          hasRestoredProgress.current = true;

          window.scrollTo({
            top: targetScroll,
            behavior: "auto",
          });

          return;
        }

        hasRestoredProgress.current = true;
      });
    };

    const syncCloudProgress = async () => {
      try {
        const userId = await getAuthenticatedUserId();

        if (!userId) {
          restoreProgress();
          return;
        }

        cloudSyncEnabled = true;

        const cloudProgress = await getCloudReadingProgress(editionId, userId);

        if (!cloudProgress) {
          if (localProgress) {
            const cloudInput = buildCloudInput(localProgress);

            if (cloudInput) {
              const savedCloud = await saveCloudReadingProgress(cloudInput);

              if (localCurrentProgress && !disposed) {
                effectiveProgress = {
                  ...localCurrentProgress,
                  editionId,
                  chapterId: cloudInput.chapterId,
                  paragraphIndex: cloudInput.paragraphIndex,
                  percentage: cloudInput.percentage,
                  updatedAt: savedCloud.updated_at,
                };

                persistLocalProgress(effectiveProgress);
              }
            }
          }
        } else {
          const localIsUsable =
            localProgress !== null && (!localProgress.editionId || localProgress.editionId === editionId);

          const localUpdatedAt = localProgress ? Date.parse(localProgress.updatedAt) : -Infinity;

          const cloudUpdatedAt = Date.parse(cloudProgress.updated_at);

          if (
            localIsUsable &&
            Number.isFinite(localUpdatedAt) &&
            Number.isFinite(cloudUpdatedAt) &&
            localUpdatedAt > cloudUpdatedAt
          ) {
            const cloudInput = buildCloudInput(localProgress);

            if (cloudInput) {
              const savedCloud = await saveCloudReadingProgress(cloudInput);

              if (localCurrentProgress && !disposed) {
                effectiveProgress = {
                  ...localCurrentProgress,
                  editionId,
                  chapterId: cloudInput.chapterId,
                  paragraphIndex: cloudInput.paragraphIndex,
                  percentage: cloudInput.percentage,
                  updatedAt: savedCloud.updated_at,
                };

                persistLocalProgress(effectiveProgress);
              }
            } else if (cloudProgress.chapter_id === chapterId) {
              effectiveProgress = createLocalProgressFromCloud(cloudProgress);

              persistLocalProgress(effectiveProgress);
            }
          } else if (cloudProgress.chapter_id === chapterId) {
            effectiveProgress = createLocalProgressFromCloud(cloudProgress);

            persistLocalProgress(effectiveProgress);
          } else {
            const resumeChapter = chapterRoutes.find((chapter) => chapter.id === cloudProgress.chapter_id);

            if (resumeChapter && resumeChapter.slug !== chapterSlug && !disposed) {
              router.replace(`/books/${bookSlug}/${resumeChapter.slug}`);

              return;
            }

            effectiveProgress = null;
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Libra: cloud reading progress synchronization failed.", error);
        }
      }

      if (disposed) {
        return;
      }

      setProgress(effectiveProgress?.percentage ?? 0);

      lastSavedProgress.current = effectiveProgress
        ? {
            percentage: effectiveProgress.percentage,
            paragraphIndex: effectiveProgress.paragraphIndex ?? 0,
          }
        : null;

      restoreProgress();
    };

    void syncCloudProgress();

    window.addEventListener("scroll", updateProgress, {
      passive: true,
    });

    return () => {
      disposed = true;

      if (cloudSaveTimer !== null) {
        clearTimeout(cloudSaveTimer);
      }

      cancelAnimationFrame(restoreScrollFrame);
      cancelAnimationFrame(progressFrame);

      window.removeEventListener("scroll", updateProgress);
    };
  }, [
    bookSlug,
    editionId,
    chapterSlug,
    chapterId,
    chapterTitle,
    chapterNumber,
    chapterIndex,
    totalChapters,
    chapterRoutes,
    router,
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
