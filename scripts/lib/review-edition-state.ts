import { isPublicEditionStatus } from "../../src/lib/editorial-status";

export function getRejectedEditionUpdate(notes: string | undefined, updatedAt: Date) {
  return {
    copyrightStatus: "REJECTED" as const,
    publicationStatus: "DRAFT" as const,
    isPreferred: false,
    verifiedAt: null,
    copyrightNotes: notes ?? "Edition rejected during copyright review.",
    updatedAt,
  };
}

export function getArchivedEditionUpdate(updatedAt: Date) {
  return {
    publicationStatus: "ARCHIVED" as const,
    isPreferred: false,
    updatedAt,
  };
}

/** What an action would write, printed by a dry run of db:review. Every action also records a row in edition_reviews. */
export function describeReviewDecision(
  action: "publish" | "reject" | "archive" | "prefer",
  copyrightStatus?: string,
): string {
  switch (action) {
    case "publish":
      return `--publish would set copyright ${copyrightStatus} and publication PUBLISHED, and record PUBLISH in edition_reviews.`;
    case "reject":
      return "--reject would set copyright REJECTED and publication DRAFT, clear preferred and verified, and record REJECT in edition_reviews.";
    case "archive":
      return "--archive would set publication ARCHIVED, clear preferred, and record ARCHIVE in edition_reviews.";
    case "prefer":
      return "--prefer would make this the preferred edition of its book for its language, and record PREFER in edition_reviews.";
  }
}

export function assertEditionCanBePreferred(publicationStatus: string, copyrightStatus: string): void {
  if (!isPublicEditionStatus(publicationStatus, copyrightStatus)) {
    throw new Error("Only a published edition with an eligible copyright status can be preferred.");
  }
}
