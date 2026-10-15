export interface ReadingProgressInput {
  userId: string;
  editionId: string;
  chapterId: string;
  paragraphIndex: number;
  percentage: number;
  updatedAt: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReadingProgressInput(value: unknown): ReadingProgressInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.userId !== "string" ||
    !uuid.test(input.userId) ||
    typeof input.editionId !== "string" ||
    !uuid.test(input.editionId) ||
    typeof input.chapterId !== "string" ||
    !uuid.test(input.chapterId) ||
    typeof input.paragraphIndex !== "number" ||
    !Number.isInteger(input.paragraphIndex) ||
    input.paragraphIndex < 0 ||
    input.paragraphIndex > 2147483647 ||
    typeof input.percentage !== "number" ||
    !Number.isInteger(input.percentage) ||
    input.percentage < 0 ||
    input.percentage > 100 ||
    typeof input.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(input.updatedAt)) ||
    Date.parse(input.updatedAt) > Date.now() + 300_000 ||
    Date.parse(input.updatedAt) < Date.parse("2020-01-01T00:00:00Z")
  )
    return null;
  return {
    userId: input.userId,
    editionId: input.editionId,
    chapterId: input.chapterId,
    paragraphIndex: input.paragraphIndex,
    percentage: input.percentage,
    updatedAt: input.updatedAt,
  };
}
