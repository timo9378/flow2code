import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export — generates out/ directory, served by standalone server
  output: "export",

  // Static export doesn't support Image Optimization, but we don't use next/image
  images: { unoptimized: true },
};

export default nextConfig;
