# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.7] — 2026-03-05

### Performance
- **Precompute `edgeSuccessors` map** — Eliminated O(N×E) per-call rebuild in `generateBlockContinuation`; successor lookup is now O(1) via pre-built map in `CompilerContext`
- **Reuse `nodeMap` in control-flow analysis** — `computeControlFlowDescendants` now receives the existing `nodeMap` instead of rebuilding a redundant `new Map()` each call

### Fixed
- **Decompiler `processForStatement` AST correctness** — Replaced fragile `.split("{")` string hack with proper AST methods (`getInitializer()`, `getCondition()`, `getIncrementor()`); fixes incorrect parsing when loop body contains object literals
- **OpenAPI YAML import** — `handleImportOpenAPI` now supports `.yaml`/`.yml` files via dynamic `import("yaml")` instead of silently failing with `JSON.parse`
- **`revokeObjectURL` download race** — Deferred `URL.revokeObjectURL` by 10 seconds after `click()` to prevent Safari/slow-browser download failures
- **CLI watch mode async I/O** — New `loadFlowProjectAsync` reads flow projects with `fs/promises` (`readFile`/`readdir`); `compileFlowDirAsync` no longer blocks the event loop with sync file I/O

### Tests
- Added `loadFlowProjectAsync` parity tests (split + JSON + error case)
- Test count: 410 tests / 33 test files

## [0.1.6] — 2026-03-05

### Fixed (Critical)
- **Compiler uses migratedIR** — `compile()` now uses validator's auto-migrated IR instead of the stale original, preventing silent data corruption on older IR versions
- **`generateConcurrentNodes` flowState overwrite** — Removed `flowState[nodeId] = rN` overwrite that replaced correct values with `undefined` (task functions already populate flowState internally)
- **`handleCompile` path traversal** — Added separator suffix to `startsWith()` check, preventing directory-prefix attacks (e.g. `/home/user` → `/home/user2/`)
- **Undo/Redo snapshot deep clone** — `createSnapshot()` now uses `structuredClone(n.data)` instead of shallow spread, preventing nested mutation from corrupting all snapshots sharing a reference

### Tests
- Added path traversal regression test, IR migration integration test
- Test count: 407 tests / 33 test files

## [0.1.5] — 2026-03-05

### Security
- **Path traversal fix** — `serveStatic` now uses `resolve()` + `startsWith()` guard with `decodeURIComponent` to prevent `../../etc/passwd` and `%2e%2e%2f` attacks

### Fixed
- **DAG swallowed errors** — `.catch(() => {})` replaced with `.catch((err) => { console.error(...) })` so concurrent promise errors are logged instead of silently discarded
- **CLI watch sync I/O** — Watch mode now uses async `readFile`/`writeFile`/`mkdir` + 150ms debounce to prevent event loop blocking
- **Source map brittle regex** — Replaced full-line regex with robust `indexOf`-based scanner for `[nodeId] ---` suffix tokens; survives Prettier/ESLint reformatting
- **Compiler state mutation** — Centralized child block registration via `applyChildBlockRegistration()` helper; plugins no longer scatter-write to context
- **env-check false positives** — `env-check` command now includes `Object.keys(process.env)` in declared vars whitelist (CI/CD injected vars)
- **Plugin error guard** — `plugin.generate()` wrapped in try/catch with descriptive error message identifying plugin, node label, and node ID; preserves `{ cause }` chain

### Added
- **Logger system** — `src/lib/logger.ts` with picocolors, log levels (debug/info/warn/error/silent), structured output (`kv`, `kvLast`, `blank`, `raw`), `--silent` CLI flag
- **picocolors** added as direct dependency (zero-dep, 3.8x faster than chalk)

### Changed
- Dev script switched back to Turbopack (`next dev --turbopack`), removed `--webpack` workaround
- Server and CLI now use structured logger instead of raw `console.log`/`console.error`
- Test count: 405 tests / 33 test files

## [0.1.0] — 2026-02-27

### Added

#### Core
- **Visual AST Compiler** — Flow-based IR → production-ready TypeScript
- **Headless compiler** — `import { compile } from "@timo9378/flow2code/compiler"` can be used standalone
- **CLI** — `flow2code compile`, `flow2code watch`, `flow2code migrate` commands
- **Standalone dev server** — Zero-dependency HTTP server (`flow2code serve`)
- **Plugin system** — `NodePlugin` interface + `PluginRegistry` factory pattern
- **15 built-in node types** — HTTP Webhook, Cron Job, Fetch API, SQL Query, Redis Cache, Custom Code, If/Else, For Loop, Try/Catch, Return Response, Declare Variable, Transform, Call Subflow, Manual Trigger

#### Platforms
- **Next.js** platform adapter (App Router)
- **Express** platform adapter
- **Cloudflare Workers** platform adapter
- Extensible `PlatformAdapter` interface, supports third-party platform registration

#### AI Features
- AI Flow Generator (OpenAI-compatible endpoints)
- Streaming support (SSE) + retry mechanism + token budget management
- Custom AI endpoint management (copilot-api / Gemini / Ollama)
- AI Code Review (automatic audit of generated IR)
- **IR Security Validator** — Scans AI-generated code for malicious patterns (eval, child_process, fs, etc.)

#### DX Improvements
- **Runtime Error Tracer** — Reverse-lookup from Error.stack via Source Map to canvas node
- **Git-Native Split Storage** — YAML directory format, supports git diff
- **Edit-Time Type Inference** — Real-time inference of upstream node flowState types
- **Dynamic Node Registry** — Extensible node definition system
- **Expression Autocomplete** — Expression input auto-completion (flowState fields + methods)
- **Decompiler** — TypeScript → FlowIR reverse parser (ts-morph AST analysis)

#### Quality
- TypeScript strict mode
- ESLint v10 flat config (0 errors)
- 354 tests / 31 test files (vitest)
- GitHub Actions CI (Node.js 20/22 matrix)
- `.husky/pre-push` CI guard
- Content-Security-Policy headers
- TypeDoc API reference generation
- Zustand undo/redo isolated slice

### Security
- IR Security Validator (`validateIRSecurity()`) three-tier threat detection
- Custom Code dangerous API compile-time warnings
- CSP / X-Content-Type-Options / X-Frame-Options / X-XSS-Protection headers
- 2MB body size limit
- IR structural validation (cycle detection, orphan node detection)
