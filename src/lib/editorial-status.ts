export const publicPublicationStatus = "PUBLISHED" as const;

export const publicCopyrightStatuses = ["PUBLIC_DOMAIN_VERIFIED", "LICENSED", "ORIGINAL"] as const;

export type PublicCopyrightStatus = (typeof publicCopyrightStatuses)[number];

export function isPublicEditionStatus(publicationStatus: string, copyrightStatus: string): boolean {
  return (
    publicationStatus === publicPublicationStatus &&
    publicCopyrightStatuses.some((status) => status === copyrightStatus)
  );
}

export function isPublicCopyrightStatus(status: string): status is PublicCopyrightStatus {
  return publicCopyrightStatuses.some((publicStatus) => publicStatus === status);
}
