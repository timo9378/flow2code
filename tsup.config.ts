import { defineConfig } from "tsup";

export default defineConfig([
  // CLI bundle
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: true,
    // 不打包 node_modules 中的依賴 — 讓 npm install 處理
    external: [
      "chokidar",
      "commander",
      "ts-morph",
      "yaml",
      // React / Next.js 只在 UI 端使用，CLI 不需要
      "react",
      "react-dom",
      "next",
      "@xyflow/react",
    ],
  },
  // Standalone Server bundle
  {
    entry: { server: "src/server/index.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: false, // 第二個 entry 不要 clean 掉第一個
    external: [
      "chokidar",
      "commander",
      "ts-morph",
      "yaml",
      "react",
      "react-dom",
      "next",
      "@xyflow/react",
    ],
  },
  // Headless Compiler bundle (純編譯器，不包含 UI/Server)
  {
    entry: { compiler: "src/lib/index.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    dts: true,
    clean: false,
    external: [
      "ts-morph",
      "yaml",
    ],
  },
]);
