import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

function getR2RemotePatterns() {
  const configuredUrl = process.env.R2_PUBLIC_URL;

  if (!configuredUrl) {
    return [];
  }

  const publicUrl = new URL(configuredUrl);

  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new Error("R2_PUBLIC_URL must be an HTTPS URL without credentials, query or fragment.");
  }

  const baseUrl = `${publicUrl.origin}${publicUrl.pathname.replace(/\/$/, "")}`;

  return [new URL(`${baseUrl}/**`)];
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: {
    // Short fallback lifetime if post-commit invalidation is unavailable.
    editorial: {
      stale: 30,
      revalidate: 60,
      expire: 300,
    },
  },
  images: {
    remotePatterns: getR2RemotePatterns(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
