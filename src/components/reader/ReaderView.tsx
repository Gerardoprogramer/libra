"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  FiArrowLeft,
  FiChevronLeft,
  FiChevronRight,
  FiList,
  FiMinus,
  FiMoon,
  FiPlus,
  FiSun,
  FiX,
} from "react-icons/fi";
import { HiOutlineBookOpen } from "react-icons/hi2";
import { TbCoffee } from "react-icons/tb";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { usePrefetchNextChapter } from "@/hooks/usePrefetchNextChapter";
import { useReaderPreferences } from "@/hooks/useReaderPreferences";
import { readerPanelThemeProps, ReaderPanelThemeProvider } from "@/lib/reader-panel-theme";
import { clearEarlyReaderPreferences, READER_MEASURES } from "@/lib/reader-preferences";
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

  /** The site's language switcher, rendered in the reader's bar (the site header is hidden on this page). */
  languageSwitcher?: ReactNode;

  /** Every chapter of the edition being read, in order, for the index. `href` is built like previousHref/nextHref. */
  chapters?: { slug: string; number: number; title: string; href: string }[];
}

// A previous/next chapter link at the end of a chapter: 44px or more, the destination's title under its direction.
const chapterLinkClass =
  "hover:bg-muted focus-visible:ring-ring/50 flex min-h-16 flex-col justify-center gap-1 rounded-xl border px-4 py-3 transition outline-none focus-visible:ring-[3px]";

// Chapter titles stored in capitals ("CHAPTER XXIV DR. SEWARD'S PHONOGRAPH DIARY") are set a step smaller and
// letter-spaced, as capitals read best. Their letters are never re-cased: they hold proper names and roman numerals.
function isSetInCapitals(title: string): boolean {
  const letters = title.match(/\p{L}/gu) ?? [];
  const capitals = letters.filter((letter) => letter !== letter.toLowerCase());

  return letters.length > 0 && capitals.length / letters.length >= 0.7;
}

// No swatch carries data-reader-theme: that attribute marks the reading surface and drives globals.css selectors.
const READER_THEMES = [
  { value: "light", label: "lightTheme", shortLabel: "lightThemeShort", Icon: FiSun },
  { value: "sepia", label: "sepiaTheme", shortLabel: "sepiaThemeShort", Icon: TbCoffee },
  { value: "dark", label: "darkTheme", shortLabel: "darkThemeShort", Icon: FiMoon },
] as const satisfies readonly { value: ReaderTheme; label: string; shortLabel: string; Icon: IconType }[];

const READER_WIDTHS = ["narrow", "medium", "wide"] as const satisfies readonly ReaderWidth[];

const settingsLabelClass = "text-muted-foreground text-xs font-medium tracking-wide uppercase";

// A choice in the settings panel: 44px tall, its selected state carried by aria-pressed.
const settingsOptionClass =
  "hover:bg-muted focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-muted aria-pressed:ring-primary flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 text-sm transition outline-none focus-visible:ring-[3px] aria-pressed:font-medium aria-pressed:ring-1";

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
  languageSwitcher,
  chapters,
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
  // The controls of the surface fade their colors on hover and focus. On hydration the stored theme replaces the
  // server's light one in the same task, so the first frame after mounting styles it with transitions off (globals.css,
  // [data-reader-settled]); they are turned on at the next frame. By then React has rendered the stored preferences, so
  // the marks the early script left on <html> for the first paint are removed in the same frame.
  const [settled, setSettled] = useState(false);
  const settingsId = useId();
  const currentChapterRef = useRef<HTMLAnchorElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  // Titles of the neighbouring chapters, from the same ordered list as previousHref/nextHref.
  const position = chapters?.findIndex((item) => item.slug === chapterSlug) ?? -1;
  const previousChapter = position > 0 ? chapters?.[position - 1] : undefined;
  const nextChapter = position >= 0 ? chapters?.[position + 1] : undefined;

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        clearEarlyReaderPreferences();
        setSettled(true);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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

  // A link's default prefetch stops at the loading placeholder; the "Next" link's is set by this hook.
  const nextChapterPrefetch = usePrefetchNextChapter(nextHref, footerRef);

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

  function changeWidth(nextWidth: ReaderWidth) {
    if (!setWidth(nextWidth)) {
      setStorageError(true);
    }
  }

  return (
    // The theme's colors are the design tokens overridden for this surface (globals.css, [data-reader-theme]).
    // The colors fade only while a panel of the bar is open (data-state="open" on its trigger), which is where the
    // reader changes the theme: the stored theme replaces the server's light one on hydration without a fade.
    <div
      data-reader-theme={theme}
      data-reader-settled={settled ? "" : undefined}
      className="bg-background text-foreground min-h-screen motion-safe:has-[[data-state=open]]:transition-colors motion-safe:has-[[data-state=open]]:duration-300"
    >
      {/* The reader's own bar replaces the site header on this page (globals.css). It stays in the document flow
          and never changes the article's height, which the progress measurement depends on. */}
      <div className="bg-background/95 sticky top-0 z-40 border-b border-current/10 backdrop-blur">
        <nav aria-label={t("readerNavigation")} className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:px-4">
          <Button variant="ghost" size="icon-lg" className="size-11" asChild>
            <Link href="/" aria-label={t("home")}>
              <HiOutlineBookOpen aria-hidden="true" className="size-5" />
            </Link>
          </Button>

          <Link
            href={`/books/${bookSlug}`}
            className="focus-visible:ring-ring/50 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm text-current/75 transition hover:text-current focus-visible:ring-2 focus-visible:outline-none"
          >
            <FiArrowLeft aria-hidden="true" className="shrink-0" />
            <span className="sr-only">{t("backToBook")} </span>
            <span lang={contentLanguage} className="truncate" title={bookTitle}>
              {bookTitle}
            </span>
          </Link>

          {chapters && chapters.length > 0 && (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="size-11 data-open:bg-current/10"
                  aria-label={t("tableOfContents")}
                >
                  <FiList aria-hidden="true" className="size-5" />
                </Button>
              </SheetTrigger>

              {/* Portaled to <body>; data-reader-panel-theme gives it this theme's tokens (globals.css). It is a modal
                  dialog: the page keeps its scroll position and layout; focus starts on the current chapter, Escape
                  closes it and returns focus to the index button, and choosing a chapter closes it while the link
                  navigates. */}
              <SheetContent
                {...readerPanelThemeProps(theme)}
                side="right"
                showCloseButton={false}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  currentChapterRef.current?.focus();
                }}
                className="gap-0"
              >
                <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
                  <div className="min-w-0 space-y-1">
                    <SheetTitle className="font-serif text-xl">{t("tableOfContents")}</SheetTitle>
                    <SheetDescription lang={contentLanguage} className="truncate" title={bookTitle}>
                      {bookTitle}
                    </SheetDescription>
                  </div>

                  <SheetClose asChild>
                    <Button variant="ghost" size="icon-lg" className="-mt-2 -mr-2 size-11 shrink-0">
                      <FiX aria-hidden="true" className="size-5" />
                      <span className="sr-only">{t("closeTableOfContents")}</span>
                    </Button>
                  </SheetClose>
                </SheetHeader>

                <nav aria-label={t("tableOfContents")} className="min-h-0 flex-1 overflow-y-auto p-2">
                  <ol className="space-y-0.5">
                    {chapters.map((item) => {
                      const current = item.slug === chapterSlug;

                      return (
                        <li key={item.slug}>
                          <SheetClose asChild>
                            <Link
                              ref={current ? currentChapterRef : undefined}
                              href={item.href}
                              aria-current={current ? "page" : undefined}
                              className="hover:bg-muted focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:border-primary flex min-h-11 items-baseline gap-3 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-sm transition outline-none focus-visible:ring-[3px] aria-[current=page]:font-medium"
                            >
                              <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">
                                {item.number}
                              </span>
                              <span lang={contentLanguage}>{item.title}</span>
                            </Link>
                          </SheetClose>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </SheetContent>
            </Sheet>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11 font-serif text-base data-open:bg-current/10"
                aria-label={t("readingSettings")}
              >
                Aa
              </Button>
            </PopoverTrigger>

            {/* Portaled to <body>; data-reader-panel-theme gives it this theme's tokens (globals.css). It opens over
                the text without moving it; focus moves in, and Escape or a click outside closes it and returns focus
                to "Aa". Changing a setting keeps it open. */}
            <PopoverContent
              {...readerPanelThemeProps(theme)}
              align="end"
              collisionPadding={8}
              aria-label={t("readingSettings")}
              className="w-[min(22rem,calc(100vw-1rem))] space-y-5"
            >
              <div className="space-y-2">
                <p id={`${settingsId}-theme`} className={settingsLabelClass}>
                  {t("themeGroup")}
                </p>

                <div role="group" aria-labelledby={`${settingsId}-theme`} className="grid grid-cols-3 gap-2">
                  {READER_THEMES.map(({ value, label, shortLabel, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={t(label)}
                      aria-pressed={theme === value}
                      onClick={() => changeTheme(value)}
                      className={settingsOptionClass}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      {t(shortLabel)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p id={`${settingsId}-size`} className={settingsLabelClass}>
                  {t("textSize")}
                </p>

                <div
                  role="group"
                  aria-labelledby={`${settingsId}-size`}
                  className="flex items-center justify-between rounded-xl border p-1"
                >
                  <Button
                    size="icon-lg"
                    variant="ghost"
                    className="size-11"
                    aria-label={t("decreaseTextSize")}
                    onClick={decreaseFontSize}
                  >
                    <FiMinus aria-hidden="true" />
                  </Button>

                  <span aria-live="polite" className="text-base tabular-nums">
                    {fontSize}
                  </span>

                  <Button
                    size="icon-lg"
                    variant="ghost"
                    className="size-11"
                    aria-label={t("increaseTextSize")}
                    onClick={increaseFontSize}
                  >
                    <FiPlus aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p id={`${settingsId}-width`} className={settingsLabelClass}>
                  {t("readingWidth")}
                </p>

                <div role="group" aria-labelledby={`${settingsId}-width`} className="grid grid-cols-3 gap-2">
                  {READER_WIDTHS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={width === value}
                      onClick={() => changeWidth(value)}
                      className={settingsOptionClass}
                    >
                      {t(value)}
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* The language menu is portaled as well; it reads this theme from the provider. */}
          {languageSwitcher && (
            <ReaderPanelThemeProvider value={theme}>
              <div className="flex shrink-0 [&_button]:min-h-11">{languageSwitcher}</div>
            </ReaderPanelThemeProvider>
          )}
        </nav>

        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-current/10">
          <div className="h-full bg-current transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <main id="main-content" className="px-6 pb-24">
        {(storageError || !preferencesAvailable) && (
          <p role="alert" className="text-destructive mx-auto mt-6 max-w-3xl text-sm">
            {t("storageUnavailable")}
          </p>
        )}

        <header lang={contentLanguage} className="mx-auto max-w-3xl py-12 text-center md:py-16">
          <p className="mb-3 text-xs tracking-[0.25em] text-current/75 uppercase">{bookTitle}</p>

          <h1
            className={cn(
              "text-balance",
              // The type scale's own line heights (32/36/40px) keep the header a whole number of pixels tall, so the
              // paragraph tops the progress restore scrolls to stay on whole pixels at the default size. Capitals get
              // a fallback sized for capitals, so the title wraps the same before and after Caslon loads.
              isSetInCapitals(chapterTitle)
                ? "font-serif-capitals text-2xl tracking-[0.04em] md:text-3xl"
                : "font-serif text-3xl tracking-tight md:text-4xl",
            )}
          >
            {chapterTitle}
          </h1>

          <p className="mt-4 text-sm text-current/75">{author}</p>
        </header>

        <article
          ref={articleRef}
          lang={contentLanguage}
          className="mx-auto"
          // data-reader-measure: before hydration, the stored size and width replace these (globals.css).
          data-reader-measure
          style={{ fontSize, maxWidth: `${READER_MEASURES[width] * fontSize}px` }}
        >
          {children}
        </article>

        <footer
          ref={footerRef}
          className="mx-auto mt-20 border-t border-current/10 pt-8"
          data-reader-measure
          style={{ maxWidth: `${READER_MEASURES[width] * fontSize}px` }}
        >
          {/* The position counts the chapters in reading order; stored numbers need not start at 1. */}
          <p className="text-muted-foreground text-center text-xs tracking-[0.2em] uppercase">
            {t("chapterOf", { current: chapterIndex + 1, total: totalChapters })}
            <span aria-hidden="true"> · </span>
            {t("progress", { progress })}
          </p>

          <nav aria-label={t("chapterNavigation")} className="mt-6 grid gap-3 sm:grid-cols-2">
            {previousHref && (
              <Link href={previousHref} rel="prev" className={chapterLinkClass}>
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs tracking-wide uppercase">
                  <FiChevronLeft aria-hidden="true" />
                  {t("previous")}
                </span>
                {previousChapter && (
                  <span lang={contentLanguage} className="line-clamp-2 font-serif text-base">
                    {previousChapter.title}
                  </span>
                )}
              </Link>
            )}

            {nextHref ? (
              <Link
                href={nextHref}
                rel="next"
                prefetch={nextChapterPrefetch.linkPrefetch}
                onFocus={nextChapterPrefetch.onLinkFocus}
                className={cn(chapterLinkClass, "border-primary text-right sm:col-start-2")}
              >
                <span className="text-primary inline-flex items-center justify-end gap-1 text-xs tracking-wide uppercase">
                  {t("next")}
                  <FiChevronRight aria-hidden="true" />
                </span>
                {nextChapter && (
                  <span lang={contentLanguage} className="line-clamp-2 font-serif text-base">
                    {nextChapter.title}
                  </span>
                )}
              </Link>
            ) : (
              // The last chapter: its way forward is the book page.
              <Link
                href={`/books/${bookSlug}`}
                className={cn(chapterLinkClass, "border-primary text-right sm:col-start-2")}
              >
                <span className="text-primary text-xs tracking-wide uppercase">{t("finish")}</span>
                <span lang={contentLanguage} className="line-clamp-2 font-serif text-base">
                  {bookTitle}
                </span>
              </Link>
            )}
          </nav>

          {nextHref && (
            <p className="mt-6 text-center">
              <Link
                href={`/books/${bookSlug}`}
                className="focus-visible:ring-ring/50 inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-current/75 transition outline-none hover:text-current focus-visible:ring-[3px]"
              >
                <FiArrowLeft aria-hidden="true" />
                {t("bookPage")}
              </Link>
            </p>
          )}
        </footer>
      </main>
    </div>
  );
}
