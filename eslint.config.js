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

  // ── TypeScript 寬鬆規則（漸進式修正） ──
  {
    rules: {
      // 暫時 warn，Phase 4 逐步清理後改 error
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

      // 允許空 catch（SSE parser 等場景需要）
      "no-empty": ["error", { allowEmptyCatch: true }],

      // 允許 console（CLI + dev server 需要）
      "no-console": "off",
    },
  },

  // ── 忽略清單 ──
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
    ],
  }
);
