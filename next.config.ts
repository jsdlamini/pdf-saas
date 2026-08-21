import type { NextConfig } from "next";

// Note: proxyClientMaxBodySize is accepted by the Next.js runtime config
// schema but not yet in the exported NextConfig TS type, hence the cast.
const nextConfig = {
  // Allow large research-project payloads (e.g. imported LaTeX zips with
  // base64 figures) through the middleware/proxy. Default is 10MB.
  proxyClientMaxBodySize: "100mb",
} as NextConfig;

export default nextConfig;
