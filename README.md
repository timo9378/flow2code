# Flow2Code

**基於 AST 編譯技術之視覺化後端邏輯生成器**

將畫布上的節點直接編譯為原生、零依賴的 TypeScript 代碼，完美整合 Next.js API Routes。

## 核心特性

- **AST 編譯而非解釋** — 使用 ts-morph 生成語法正確的 TypeScript，杜絕字串拼接的語法錯誤
- **零依賴產出** — 生成的代碼不依賴任何 Runtime，可直接部署到 Vercel / AWS Lambda
- **flowState 模式** — 跨節點數據傳遞具備型別安全
- **自動並發偵測** — 拓撲排序識別獨立節點，自動生成 `Promise.all`
- **環境變數保護** — 敏感資訊自動轉為 `process.env.XXX`

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端畫布 | Next.js 15 + React Flow (@xyflow/react) |
| 狀態管理 | Zustand |
| IR 規範 | 自定義 JSON Schema + TypeScript Types |
| AST 引擎 | ts-morph (TypeScript Compiler API Wrapper) |
| CLI | Commander.js + Chokidar |
| 測試 | Vitest |

## 快速開始

```bash
# 安裝依賴
pnpm install

# 啟動開發伺服器（視覺化畫布）
pnpm dev

# 執行測試
pnpm test:run

# 初始化範例 flow
pnpm compile -- init

# 編譯單一 .flow.json（預覽模式）
npx tsx src/cli/index.ts compile flows/hello.flow.json --dry-run

# 監聽模式（檔案變動自動編譯）
npx tsx src/cli/index.ts watch flows/
```

## 專案結構

```
flow2code/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/compile/        # 編譯 API 端點
│   │   ├── layout.tsx
│   │   └── page.tsx            # 主畫布頁面
│   ├── components/
│   │   ├── FlowCanvas.tsx      # 主畫布元件
│   │   ├── nodes/
│   │   │   └── FlowNode.tsx    # 統一自定義節點渲染
│   │   └── panels/
│   │       ├── ConfigPanel.tsx  # 右側配置面板
│   │       ├── NodeLibrary.tsx  # 左側節點庫
│   │       └── Toolbar.tsx     # 頂部工具列
│   ├── lib/
│   │   ├── compiler/
│   │   │   └── compiler.ts     # AST 編譯器核心 (ts-morph)
│   │   └── ir/
│   │       ├── types.ts        # IR Schema + TypeScript 型別定義
│   │       ├── validator.ts    # IR 驗證器
│   │       └── topological-sort.ts  # 拓撲排序 + 並發偵測
│   ├── store/
│   │   └── flow-store.ts       # Zustand 畫布狀態管理
│   └── cli/
│       └── index.ts            # CLI 工具 (compile/watch/init)
├── tests/
│   ├── fixtures.ts             # 測試用 IR 工廠
│   ├── ir/                     # IR 驗證 & 排序測試
│   └── compiler/               # 編譯器測試
└── vitest.config.ts
```

## 節點類型

| 分類 | 節點 | 編譯產物 |
|------|------|----------|
| ⚡ 觸發器 | HTTP Webhook | `export async function POST(req: Request)` |
| ⚡ 觸發器 | Cron Job | Scheduled function |
| ⚡ 觸發器 | Manual | Exported async function |
| 🔧 執行器 | Fetch API | `await fetch(...)` + try/catch |
| 🔧 執行器 | SQL Query | Drizzle / Prisma / Raw SQL |
| 🔧 執行器 | Redis Cache | Redis get/set/del |
| 🔧 執行器 | Custom Code | 直接插入 TypeScript |
| 🔀 邏輯 | If/Else | `if (...) { } else { }` |
| 🔀 邏輯 | For Loop | `for (const item of ...)` |
| 🔀 邏輯 | Try/Catch | `try { } catch (e) { }` |
| 🔀 邏輯 | Promise.all | `await Promise.all([...])` |
| 📦 變數 | Declare | `const x = ...` |
| 📦 變數 | Transform | Expression transform |
| 📤 輸出 | Return Response | `NextResponse.json(...)` |

## 開發路線圖

- [x] Phase 1: IR Schema + 拓撲排序
- [x] Phase 2: 視覺化畫布 (React Flow + Zustand)
- [x] Phase 3: AST 編譯器核心 (ts-morph)
- [x] Phase 4: CLI 工具 (compile/watch/init)
- [x] Phase 5: TDD 測試覆蓋 (Vitest)
- [ ] Phase 6: 外掛生態系 (Custom Node API)
- [ ] Phase 7: 雲端同步 + 協作編輯

## LICENSE

MIT
