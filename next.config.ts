import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output — self-contained Node.js server with RSC support
  output: "standalone",

  // Pin the tracing root to this package so .next/standalone/server.js lands
  // where flow2code.service expects it (parent dirs contain other lockfiles,
  // which makes Next infer a workspace root and nest the standalone output)
  outputFileTracingRoot: __dirname,

  // We don't use next/image optimization
  images: { unoptimized: true },

  // Skip ESLint during build — we run lint separately in CI
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
