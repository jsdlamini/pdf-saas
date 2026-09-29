import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The LaTeX compile route receives every text file in a project, and large
    // book/course projects (e.g. CSI203 with CH1–CH7) legitimately exceed the
    // 10MB default. Allow up to 50MB (matches the nginx client_max_body_size).
    proxyClientMaxBodySize: 50 * 1024 * 1024,
  },
};

export default nextConfig;
