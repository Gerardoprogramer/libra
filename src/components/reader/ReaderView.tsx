"use client";

import { Link } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiMinus, FiMoon, FiPlus, FiSun } from "react-icons/fi";
import { TbCoffee } from "react-icons/tb";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReaderPreferences } from "@/hooks/useReaderPreferences";

type ReaderTheme = "light" | "sepia" | "dark";
type ReaderWidth = "narrow" | "medium" | "wide";

interface ReaderViewProps {
  bookSlug: string;
  bookTitle: string;
  author: string;

  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: number;

  totalChapters: number;
  paragraphs: string[];

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
  totalChapters,
  paragraphs,
  previousHref,
  nextHref,
}: ReaderViewProps) {
  const articleRef = useRef<HTMLElement>(null);
  const { theme, width, fontSize, setTheme, setWidth, setFontSize } = useReaderPreferences();

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const article = articleRef.current;

      if (!article) return;

      const articleTop = article.getBoundingClientRect().top + window.scrollY;
      const readableHeight = Math.max(article.offsetHeight - window.innerHeight, 1);

      const current = window.scrollY - articleTop;
      const percentage = Math.min(Math.max((current / readableHeight) * 100, 0), 100);

      const roundedProgress = Math.round(percentage);

      setProgress(roundedProgress);

      localStorage.setItem(
        `libra:progress:${bookSlug}`,
        JSON.stringify({
          bookSlug,
          chapterSlug,
          chapterTitle,
          chapterNumber,
          percentage: roundedProgress,
          updatedAt: new Date().toISOString(),
        }),
      );
    };

    updateProgress();

    window.addEventListener("scroll", updateProgress, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateProgress);
    };
  }, [bookSlug, chapterSlug, chapterTitle, chapterNumber]);

  function decreaseFontSize() {
    setFontSize(fontSize - 2);
  }

  function increaseFontSize() {
    setFontSize(fontSize + 2);
  }

  return (
    <div className={cn("min-h-screen transition-colors duration-300", themeClasses[theme])}>
      <div className="sticky top-16 z-40 h-1 bg-current/10">
        <div className="h-full bg-current transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col gap-5 border-b border-current/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <Link
            href={`/books/${bookSlug}`}
            className="inline-flex items-center gap-2 text-sm opacity-60 transition hover:opacity-100"
          >
            <FiArrowLeft />
            {bookTitle}
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-current/15 p-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setTheme("light")}
                className={cn(theme === "light" && "bg-current/10")}
              >
                <FiSun />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setTheme("sepia")}
                className={cn(theme === "sepia" && "bg-current/10")}
              >
                <TbCoffee />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setTheme("dark")}
                className={cn(theme === "dark" && "bg-current/10")}
              >
                <FiMoon />
              </Button>
            </div>

            <div className="flex items-center rounded-lg border border-current/15 p-1">
              <Button size="icon" variant="ghost" onClick={decreaseFontSize}>
                <FiMinus />
              </Button>

              <span className="w-10 text-center text-sm">{fontSize}</span>

              <Button size="icon" variant="ghost" onClick={increaseFontSize}>
                <FiPlus />
              </Button>
            </div>

            <Select value={width} onValueChange={(value) => setWidth(value as ReaderWidth)}>
              <SelectTrigger className="w-32 border-current/15 bg-transparent">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="narrow">Narrow</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="wide">Wide</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <main className="px-6 pb-24">
        <header className="mx-auto max-w-3xl py-12 text-center md:py-16">
          <p className="mb-3 text-xs tracking-[0.25em] uppercase opacity-50">{bookTitle}</p>

          <h1 className="font-serif text-4xl tracking-tight md:text-5xl">{chapterTitle}</h1>

          <p className="mt-4 text-sm opacity-50">{author}</p>
        </header>

        <article ref={articleRef} className={cn("mx-auto transition-all", widthClasses[width])}>
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-7 font-serif leading-[1.95] opacity-90" style={{ fontSize }}>
              {paragraph}
            </p>
          ))}
        </article>

        <footer className={cn("mx-auto mt-20 border-t border-current/10 pt-8", widthClasses[width])}>
          <div className="flex items-center justify-between gap-4">
            {previousHref ? (
              <Button variant="outline" asChild>
                <Link href={previousHref}>
                  <FiChevronLeft />
                  Previous
                </Link>
              </Button>
            ) : (
              <div />
            )}

            <div className="text-center">
              <p className="text-xs opacity-50">
                Chapter {chapterNumber} of {totalChapters}
              </p>

              <p className="mt-1 text-xs opacity-40">{progress}% read</p>
            </div>

            {nextHref ? (
              <Button asChild>
                <Link href={nextHref}>
                  Next
                  <FiChevronRight />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href={`/books/${bookSlug}`}>Finish</Link>
              </Button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
