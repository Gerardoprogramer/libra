"use client";

import { createClient } from "@/lib/supabase/client";

import type { ReadingProgress } from "@/lib/reading-progress";

export interface CloudReadingProgress {
  id: string;
  user_id: string;
  edition_id: string;
  chapter_id: string;
  paragraph_index: number;
  percentage: number;
  created_at: string;
  updated_at: string;
}

export interface SaveCloudReadingProgressInput {
  editionId: string;
  chapterId: string;
  paragraphIndex: number;
  percentage: number;
  updatedAt: string;
}

export interface CloudReadingProgressHistoryItem {
  id: string;
  userId: string;
  editionId: string;
  chapterId: string;
  paragraphIndex: number;
  percentage: number;
  createdAt: string;
  updatedAt: string;

  bookSlug: string;

  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: number;
  chapterIndex: number;
  totalChapters: number;

  contentLanguage: string;
}

export function toReadingProgress(item: CloudReadingProgressHistoryItem): ReadingProgress {
  return {
    bookSlug: item.bookSlug,
    editionId: item.editionId,
    contentLanguage: item.contentLanguage,
    chapterSlug: item.chapterSlug,
    chapterId: item.chapterId,
    chapterTitle: item.chapterTitle,
    chapterNumber: item.chapterNumber,
    chapterIndex: item.chapterIndex,
    totalChapters: item.totalChapters,
    paragraphIndex: item.paragraphIndex,
    percentage: item.percentage,
    updatedAt: item.updatedAt,
  };
}

const READING_PROGRESS_COLUMNS = "id,user_id,edition_id,chapter_id,paragraph_index,percentage,created_at,updated_at";

export async function getCloudReadingProgress(editionId: string, userId: string): Promise<CloudReadingProgress | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("reading_progress")
    .select(READING_PROGRESS_COLUMNS)
    .eq("user_id", userId)
    .eq("edition_id", editionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as CloudReadingProgress | null;
}

export async function saveCloudReadingProgress(input: SaveCloudReadingProgressInput, userId: string): Promise<boolean> {
  // Capture the owner when reading, never substitute whichever account happens
  // to be logged in when an asynchronous save finishes.
  const response = await fetch("/api/reading-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, userId }),
    keepalive: true,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Failed to save reading progress.");
  const payload: { accepted: boolean } = await response.json();
  return payload.accepted;
}

export async function getCloudReadingProgressHistory(
  userId: string,
  editionId?: string,
): Promise<CloudReadingProgressHistoryItem[] | null> {
  const url = editionId ? `/api/reading-progress?edition=${encodeURIComponent(editionId)}` : "/api/reading-progress";
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  let payload: {
    progress?: CloudReadingProgressHistoryItem[];
    error?: string;
  };

  try {
    payload = (await response.json()) as {
      progress?: CloudReadingProgressHistoryItem[];
      error?: string;
    };
  } catch {
    throw new Error("Invalid reading progress response.");
  }

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to retrieve reading progress.");
  }

  // A cookie may have changed while the request was starting.
  return Array.isArray(payload.progress) ? payload.progress.filter((item) => item.userId === userId) : [];
}
