// @ts-check
import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve @/ path alias to the main project's src/ directory.
 * This allows the extension to import compiler/decompiler/validator
 * directly from the flow2code source tree.
 * @type {import('esbuild').Plugin}
 */
const aliasPlugin = {
  name: "flow2code-alias",
  setup(build) {
    // Resolve @/ → ../src/ with TypeScript extension resolution
    build.onResolve({ filter: /^@\// }, async (args) => {
      const importPath = args.path.slice(2); // strip @/
      const basePath = path.resolve(__dirname, "..", "src", importPath);

      // Try .ts, .tsx, /index.ts, /index.tsx in order
      const { existsSync } = await import("fs");
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const candidate = basePath + ext;
        if (existsSync(candidate)) {
          return { path: candidate };
        }
      }

      // Fallback — return as-is and let esbuild report the error
      return { path: basePath };
    });
  },
};

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: !watch,
  treeShaking: true,
  plugins: [aliasPlugin],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("[esbuild] watching for changes...");
} else {
  await esbuild.build(buildOptions);
}
