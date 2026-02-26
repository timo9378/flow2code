# Flow2Code

**The Visual AST Compiler for Backend APIs.**

> AI generates the graph, you review it visually, the compiler outputs production-ready TypeScript.

[![CI](https://github.com/<your-org>/flow2code/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-org>/flow2code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```
使用者 → 自然語言 → AI → IR JSON → flow2code compiler → TypeScript
                          ↑                              ↓
                    可視化畫布 ←──── 雙向同步 ───→ 生成代碼
```

## Why Flow2Code?

| 傳統 Low‑Code | Flow2Code |
|---|---|
| 綁定私有 Runtime | **零依賴** — 產出原生 TypeScript，直接部署 |
| 黑盒節點 | **AST 編譯** — ts-morph 生成語法正確的真實代碼 |
| 單一平台鎖定 | **多平台** — Next.js、Express、Cloudflare Workers |
| 無法版控 | **Git-friendly** — IR 是 JSON，可 diff/PR review |
| 開發者不信任 | **可視化審計** — 畫布 ↔ 代碼雙向映射 |

## 核心特性

- **AST 編譯而非解釋** — 使用 ts-morph 生成語法正確的 TypeScript，杜絕字串拼接的語法錯誤
- **零依賴產出** — 生成的代碼不依賴任何 Runtime，可直接部署到 Vercel / AWS Lambda / Cloudflare
- **多平台輸出** — 同一套 Flow 可編譯為 Next.js、Express、Cloudflare Workers 三種風格
- **per-instance Plugin System** — 節點邏輯可外掛擴充，編譯間互不汙染
- **flowState + 型別推論** — 跨節點數據傳遞具備 TypeScript 型別安全
- **自動並發偵測** — 拓撲排序識別獨立節點，自動生成 `Promise.allSettled` + `.catch` 防護
- **環境變數保護** — 敏感資訊自動轉為 `process.env.XXX`
- **Expression Parser** — Recursive Descent Parser 解析 `$input` / `$trigger` / `$node.xxx` 模板語法
- **Semantic Diff** — 結構化比較兩版 IR 的變動

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端畫布 | Next.js 16 + React 19 + React Flow (@xyflow/react v12) |
| 狀態管理 | Zustand 5 |
| IR 規範 | 自定義 JSON Schema + TypeScript Types |
| AST 引擎 | ts-morph 27 (TypeScript Compiler API Wrapper) |
| 平台適配 | NextjsPlatform / ExpressPlatform / CloudflarePlatform |
| Plugin 系統 | `createPluginRegistry()` 工廠模式（per-instance） |
| CLI | Commander.js + Chokidar |
| 測試 | Vitest 4 — 207+ tests |
| CI | GitHub Actions (Node 20/22 矩陣) |

## 快速開始

```bash
# 安裝依賴
pnpm install

# 啟動開發伺服器（視覺化畫布）
pnpm dev

# 執行測試
pnpm test:run

# 編譯單一 .flow.json（預覽模式）
npx tsx src/cli/index.ts compile flows/hello.flow.json --dry-run

# 指定平台編譯
npx tsx src/cli/index.ts compile flows/hello.flow.json --platform express

# 監聽模式（檔案變動自動編譯）
npx tsx src/cli/index.ts watch flows/

# 建置 CLI + Compiler
pnpm build:cli
```

## Headless 使用（不需 UI）

```ts
import { compile } from "flow2code/compiler";

const ir = JSON.parse(fs.readFileSync("my-api.flow.json", "utf-8"));
const result = compile(ir, { platform: "express" });

if (result.success) {
  fs.writeFileSync(result.filePath!, result.code!);
}
```

## 專案結構

```
flow2code/
├── src/
│   ├── app/                         # Next.js App Router (UI)
│   ├── components/                  # 視覺化畫布元件
│   ├── store/                       # Zustand 畫布狀態管理
│   ├── lib/
│   │   ├── index.ts                 # Headless Compiler 公開 API
│   │   ├── ir/
│   │   │   ├── types.ts             # IR Schema + TypeScript 型別
│   │   │   ├── validator.ts         # IR 驗證器
│   │   │   └── topological-sort.ts  # 拓撲排序 + 並發偵測
│   │   ├── compiler/
│   │   │   ├── compiler.ts          # AST 編譯器核心
│   │   │   ├── expression-parser.ts # Recursive Descent Parser
│   │   │   ├── type-inference.ts    # 型別推論引擎
│   │   │   ├── symbol-table.ts      # 人類可讀變數命名
│   │   │   ├── plugins/             # Plugin 系統（可擴充）
│   │   │   │   ├── types.ts         # PluginRegistry 介面
│   │   │   │   └── builtin.ts       # 14 個內建 Plugin
│   │   │   └── platforms/           # Platform Adapter
│   │   │       ├── types.ts         # PlatformAdapter 介面
│   │   │       ├── nextjs.ts        # Next.js App Router
│   │   │       ├── express.ts       # Express.js
│   │   │       └── cloudflare.ts    # Cloudflare Workers
│   │   ├── diff/                    # Semantic Diff
│   │   └── storage/                 # .flow.json 分割/合併
│   ├── cli/                         # CLI (compile/watch/init)
│   └── server/                      # Standalone HTTP Server
├── tests/                           # 207+ tests (Vitest)
├── .github/workflows/ci.yml         # GitHub Actions CI
├── CONTRIBUTING.md
├── ROADMAP.md
└── vitest.config.ts
```

## 節點類型

| 分類 | 節點 | 編譯產物 |
|------|------|----------|
| ⚡ 觸發器 | HTTP Webhook | `export async function POST(req)` |
| ⚡ 觸發器 | Cron Job | Scheduled function |
| ⚡ 觸發器 | Manual | Exported async function |
| 🔧 執行器 | Fetch API | `await fetch(...)` + try/catch |
| 🔧 執行器 | SQL Query | Drizzle / Prisma / Raw SQL |
| 🔧 執行器 | Redis Cache | Redis get/set/del |
| 🔧 執行器 | Custom Code | 直接插入 TypeScript |
| 🔧 執行器 | Call Subflow | `await importedFunction(...)` |
| 🔀 邏輯 | If/Else | `if (...) { } else { }` |
| 🔀 邏輯 | For Loop | `for (const item of ...)` |
| 🔀 邏輯 | Try/Catch | `try { } catch (e) { }` |
| 🔀 邏輯 | Promise.all | `await Promise.allSettled([...])` |
| 📦 變數 | Declare | `const x = ...` |
| 📦 變數 | Transform | Expression transform |
| 📤 輸出 | Return Response | 平台對應 Response（NextResponse / res.json / new Response） |

## 平台支援

| 平台 | 觸發器初始化 | Response | CLI Flag |
|------|-------------|----------|----------|
| **Next.js** (預設) | `req.nextUrl.searchParams` / `req.json()` | `NextResponse.json()` | `--platform nextjs` |
| **Express** | `req.query` / `req.body` | `res.status().json()` | `--platform express` |
| **Cloudflare Workers** | `new URL(request.url)` / `request.json()` | `new Response()` | `--platform cloudflare` |

## 貢獻

參閱 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路線圖

參閱 [ROADMAP.md](ROADMAP.md)。

## LICENSE

MIT
