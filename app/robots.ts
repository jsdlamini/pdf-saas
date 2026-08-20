import type { MetadataRoute } from "next";

const DEFAULT_SITE_URL = "http://localhost:3000";

function getSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  try {
    return new URL(raw);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/history", "/dashboard"],
      },
    ],
    sitemap: `${siteUrl.toString()}sitemap.xml`,
    host: siteUrl.toString(),
  };
}
