import { and, eq, inArray } from "drizzle-orm";

import { editions } from "../schema";
import { publicCopyrightStatuses, publicPublicationStatus } from "../../lib/editorial-status";

export function getPublicEditionVisibilityCondition() {
  return and(
    eq(editions.publicationStatus, publicPublicationStatus),
    inArray(editions.copyrightStatus, publicCopyrightStatuses),
  );
}
