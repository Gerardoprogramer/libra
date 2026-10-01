import type { MetadataRoute } from "next";

import { createRobotsMetadata } from "@/lib/public-index";
import { getConfiguredSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return createRobotsMetadata(getConfiguredSiteUrl());
}
