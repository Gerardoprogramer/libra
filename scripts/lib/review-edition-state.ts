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

export function assertEditionCanBePreferred(publicationStatus: string, copyrightStatus: string): void {
  if (!isPublicEditionStatus(publicationStatus, copyrightStatus)) {
    throw new Error("Only a published edition with an eligible copyright status can be preferred.");
  }
}
