import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 靜態匯出 — 產生 out/ 目錄，由 standalone server 提供服務
  output: "export",

  // 靜態匯出不支援 Image Optimization，但我們沒用到 next/image
  images: { unoptimized: true },
};

export default nextConfig;
