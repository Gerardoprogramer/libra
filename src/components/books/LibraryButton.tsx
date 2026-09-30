"use client";

import { FiHeart } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { useLibrary } from "@/hooks/useLibrary";
import { toggleBookInLibrary } from "@/lib/library";
import { cn } from "@/lib/utils";

interface LibraryButtonProps {
  bookSlug: string;
  addLabel: string;
  removeLabel: string;
}

export function LibraryButton({ bookSlug, addLabel, removeLabel }: LibraryButtonProps) {
  const { entries, isReady } = useLibrary();

  const isSaved = entries.some((entry) => entry.bookSlug === bookSlug);

  return (
    <Button
      type="button"
      size="lg"
      variant={isSaved ? "secondary" : "outline"}
      disabled={!isReady}
      onClick={() => toggleBookInLibrary(bookSlug)}
    >
      <FiHeart className={cn(isSaved && "fill-current")} />

      {isSaved ? removeLabel : addLabel}
    </Button>
  );
}
