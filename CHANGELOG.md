# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-02-27

### Added

#### Core
- **Visual AST Compiler** — Flow-based IR → production-ready TypeScript
- **Headless compiler** — `import { compile } from "flow2code/compiler"` can be used standalone
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
- 332 tests / 29 test files (vitest)
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
