import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // ── Base rules ──
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Global settings ──
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // ── TypeScript lenient rules (incremental cleanup) ──
  {
    rules: {
      // Temporarily warn, will change to error after cleanup
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",

      // Allow empty catch (needed by SSE parser, etc.)
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Allow console (needed by CLI + dev server)
      "no-console": "off",
    },
  },

  // ── Ignore list ──
  {
    ignores: [
      "node_modules/",
      "dist/",
      "out/",
      ".next/",
      "coverage/",
      "*.config.js",
      "*.config.mjs",
      "*.config.cjs",
      "next-env.d.ts",
      "debug-ast.js",
    ],
  }
);
