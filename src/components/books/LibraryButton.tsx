"use client";

import { useState } from "react";
import { FiHeart } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { useLibrary } from "@/hooks/useLibrary";
import { toggleBookInLibrary } from "@/lib/library";
import { cn } from "@/lib/utils";

interface LibraryButtonProps {
  bookSlug: string;
  addLabel: string;
  removeLabel: string;
  errorLabel: string;
  bookTitle?: string;
  size?: "sm" | "lg";
}

export function LibraryButton({
  bookSlug,
  addLabel,
  removeLabel,
  errorLabel,
  bookTitle,
  size = "lg",
}: LibraryButtonProps) {
  const { entries, isReady, isAvailable } = useLibrary();
  const [hasError, setHasError] = useState(false);

  const isSaved = entries.some((entry) => entry.bookSlug === bookSlug);
  const label = isSaved ? removeLabel : addLabel;

  return (
    <div>
      <Button
        type="button"
        size={size}
        variant={isSaved ? "secondary" : "outline"}
        className="h-auto min-h-10 max-w-full py-2 text-left whitespace-normal"
        disabled={!isAvailable}
        aria-label={bookTitle ? `${label}: ${bookTitle}` : label}
        onClick={() => setHasError(toggleBookInLibrary(bookSlug) === null)}
      >
        <FiHeart aria-hidden="true" className={cn(isSaved && "fill-current")} />

        {label}
      </Button>

      {(hasError || (isReady && !isAvailable)) && (
        <p role="alert" className="text-destructive mt-2 max-w-xs text-sm">
          {errorLabel}
        </p>
      )}
    </div>
  );
}
