"use client";

import { useState } from "react";
import { FiCheck, FiShare2 } from "react-icons/fi";

import { Button } from "@/components/ui/button";

interface BookShareButtonProps {
  title: string;
  text: string;
  url?: string;
  label: string;
  copiedLabel: string;
  errorLabel: string;
}

export function BookShareButton({ title, text, url, label, copiedLabel, errorLabel }: BookShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  async function handleShare() {
    setCopied(false);
    setError(false);

    const shareUrl = url ?? window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url: shareUrl,
        });

        return;
      } catch (err) {
        // Cancelar el diálogo de compartir no es un error.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        // Si el Web Share API falla, intentamos copiar el enlace.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch (err) {
      console.error("Unable to share or copy book URL:", err);
      setError(true);

      window.setTimeout(() => {
        setError(false);
      }, 2500);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={handleShare}
        aria-label={error ? errorLabel : copied ? copiedLabel : label}
        title={error ? errorLabel : copied ? copiedLabel : label}
      >
        {copied ? <FiCheck aria-hidden="true" /> : <FiShare2 aria-hidden="true" />}

        <span className="sr-only">{error ? errorLabel : copied ? copiedLabel : label}</span>
      </Button>

      {copied && (
        <span className="text-muted-foreground text-sm" role="status" aria-live="polite">
          {copiedLabel}
        </span>
      )}

      {error && (
        <span className="text-muted-foreground text-sm" role="status" aria-live="polite">
          {errorLabel}
        </span>
      )}
    </div>
  );
}
