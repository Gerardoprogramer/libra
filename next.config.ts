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
  // Preserve Next.js 16.4's HTML-limited bots, plus Googlebot and TelegramBot.
  // Browsers need streaming metadata: a catch-all blocks instant validation
  // when metadata depends on searchParams or unprefetched chapter params.
  htmlLimitedBots:
    /[\w-]+-Google|Google-[\w-]+|Googlebot|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|TelegramBot/i,
  experimental: {
    // The PostgreSQL client has one connection per worker. Keep prerendered
    // pages from queuing enough concurrent editorial queries to time out.
    cpus: 2,
    staticGenerationMaxConcurrency: 2,
  },
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
    // Match 280px covers and avoid rounding dense-screen requests up to 640px.
    imageSizes: [32, 48, 64, 96, 128, 256, 280, 320, 384, 448, 512, 560],
    qualities: [50, 65, 75],
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
