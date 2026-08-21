import type { NextConfig } from "next";

const nextConfig = {
  experimental: {
    // Allow large research-project payloads (e.g. imported LaTeX zips with
    // base64 figures) through the middleware/proxy. Default is 10MB.
    proxyClientMaxBodySize: "100mb",
  },
} as NextConfig;

export default nextConfig;
