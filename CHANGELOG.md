# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2025-02-27

### Added

#### Core
- **Visual AST Compiler** — Flow-based IR → production-ready TypeScript
- **Headless compiler** — `import { compile } from "flow2code/compiler"` 可獨立使用
- **CLI** — `flow2code compile`, `flow2code watch`, `flow2code migrate` 指令
- **Standalone dev server** — 零依賴 HTTP server（`flow2code serve`）
- **Plugin system** — `NodePlugin` interface + `PluginRegistry` 工廠模式
- **15 built-in node types** — HTTP Webhook, Cron Job, Fetch API, SQL Query, Redis Cache, Custom Code, If/Else, For Loop, Try/Catch, Return Response, Declare Variable, Transform, Call Subflow, Manual Trigger

#### Platforms
- **Next.js** platform adapter (App Router)
- **Express** platform adapter
- **Cloudflare Workers** platform adapter
- 可擴展 `PlatformAdapter` 介面，支援第三方平台註冊

#### AI Features
- AI Flow Generator（OpenAI-compatible endpoints）
- Streaming 支援（SSE）+ 重試機制 + Token budget 管理
- 自訂 AI 端點管理（copilot-api / Gemini / Ollama）
- AI Code Review（自動審計生成的 IR）
- **IR Security Validator** — 掃描 AI 生成代碼的惡意模式（eval, child_process, fs 等）

#### DX Improvements
- **Runtime Error Tracer** — 從 Error.stack 反查 Source Map 至畫布節點
- **Git-Native Split Storage** — YAML 目錄格式，支援 git diff
- **Edit-Time Type Inference** — 即時推斷上游節點 flowState 型別
- **Dynamic Node Registry** — 可擴展的節點定義系統
- **Expression Autocomplete** — 表達式輸入框自動補全（flowState 欄位 + 方法）
- **Decompiler** — TypeScript → FlowIR 反向解析（ts-morph AST 分析）

#### Quality
- TypeScript strict mode
- ESLint v10 flat config (0 errors)
- 332 tests / 29 test files (vitest)
- GitHub Actions CI (Node.js 20/22 matrix)
- `.husky/pre-push` CI guard
- Content-Security-Policy headers
- TypeDoc API reference generation
- Zustand undo/redo 獨立 slice

### Security
- IR Security Validator (`validateIRSecurity()`) 三級威脅偵測
- Custom Code 危險 API 編譯時警告
- CSP / X-Content-Type-Options / X-Frame-Options / X-XSS-Protection headers
- 2MB body size limit
- IR structural validation (cycle detection, orphan node detection)
