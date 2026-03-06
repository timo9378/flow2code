# Known Issues — Flow2Code v0.2.1

Issues discovered during testing. Tracked across v0.2.x patches.

---

## P0 — Critical (Fixed in v0.2.0)

### ✅ Infinite Re-render Loop on Canvas
- **Status:** Fixed
- **Files:** `src/components/nodes/FlowNode.tsx`, `src/hooks/use-flow-lint.ts`
- **Root Cause:** `useFlowStore((s) => s.nodeBadges[id] ?? [])` created a new array reference on every store update; `Object.is([], [])` is `false`, causing Zustand to re-render FlowNode infinitely.
- **Fix:** Use a stable `EMPTY_BADGES` constant + shallow comparison in `useFlowLint` before calling `setNodeBadges`.

### ✅ Platform Registration Tree-Shaking
- **Status:** Fixed
- **Files:** `src/lib/compiler/compiler.ts`, `src/lib/compiler/platforms/index.ts`
- **Root Cause:** Turbopack (Next.js 16) tree-shook barrel file (`platforms/index.ts`) side effects, so `registerPlatform()` calls never executed in API routes → "Unknown platform nextjs".
- **Fix:** Register platforms directly in `compiler.ts` to ensure they survive bundler optimization.

---

## P1 — Important (Fixed in v0.2.1)

### ✅ Duplicate API Handler Logic
- **Status:** Fixed
- **Files:** `src/app/api/*/route.ts` → `src/server/handlers.ts`
- **Root Cause:** API logic duplicated between Next.js routes and standalone server handlers.
- **Fix:** All 4 Next.js routes are now thin wrappers delegating to `handlers.ts`.

### ✅ Bundle Size — server.js / cli.js at 5.5MB each
- **Status:** Fixed
- **Files:** `tsup.config.ts`
- **Root Cause:** Prettier (not ts-morph) was being inlined — all plugins totaling 5.4MB.
- **Fix:** Added `prettier` to `external` in tsup config. Result: server.js 145KB, cli.js 191KB (97% reduction).

---

## P2 — Minor

### ✅ OpenAPI Tag-Based Filtering Not Implemented
- **Status:** Fixed
- **Files:** `src/app/api/import-openapi/route.ts` → delegates to `src/server/handlers.ts`
- **Fix:** Route now delegates to `handleImportOpenAPI()` which has proper tag matching via `flow.meta.tags`.

### ✅ Missing .gitignore Entries
- **Status:** Fixed
- **Description:** Added `playwright-report/` and `test-results/` to `.gitignore`.

### Tailwind CSS v4 Lint Warnings (27 warnings)
- **Status:** Open — cosmetic, deferred to v0.3.0
- **Files:** `Toolbar.tsx`, `ConfigPanel.tsx`, `FlowNode.tsx`, `expression-input.tsx`, `ApiSandbox.tsx`
- **Description:** Arbitrary values like `max-w-[600px]` should be migrated to Tailwind v4 utility classes.

---

## Notes

- All 413 unit tests pass (Vitest)
- All 20 E2E tests pass (Playwright + Chromium)
- `strict: true` is enabled in tsconfig.json
- Security audit passed (OWASP Top 10 hardened in v0.1.6–v0.1.9)
