import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output — self-contained Node.js server with RSC support
  output: "standalone",

  // We don't use next/image optimization
  images: { unoptimized: true },

  // Skip ESLint during build — we run lint separately in CI
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
