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
    // Don't bundle node_modules dependencies — let npm install handle them
    external: [
      "chokidar",
      "commander",
      "ts-morph",
      "yaml",
      // React / Next.js are UI-only, not needed by CLI
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
    clean: false, // Don't clean output from the first entry
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
  // Headless Compiler bundle (pure compiler, no UI/Server)
  {
    entry: { compiler: "src/lib/index.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    dts: true,
    tsconfig: "tsconfig.build.json",
    clean: false,
    external: [
      "ts-morph",
      "yaml",
    ],
  },
]);
