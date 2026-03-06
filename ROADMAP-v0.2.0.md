# Flow2Code v0.2.0 Roadmap — ✅ COMPLETED

> All items below have been implemented and shipped in v0.2.0.

## 階段一：強化即時回饋與視覺化除錯 ✅

### 1. Visual Source Map ✅
- 擴展 `src/lib/compiler/runtime-tracer.ts`
- 編譯後程式碼報錯或 log 輸出時，UI 畫布上對應節點能發光或顯示錯誤標籤 (Badge)
- 利用現有 source map 機制 (`traceLineToNode`) 做 runtime 映射

### 2. 強化表達式輸入 (Expression Input) ✅
- 優化 `src/components/ui/expression-input.tsx`
- 整合 Monaco Editor 或更強的 LSP
- 在節點內寫小段邏輯或 SQL 時，有 TypeScript 自動補全與即時語法檢查

### 3. 完善 Linting 提示 ✅
- 利用現有 `src/lib/ir/validator.ts`
- 連錯線（例如 String 輸出連到 Boolean 輸入）時即時在畫布上給予紅色警告
- 不需等到 Compile 才報錯

---

## 階段二：程式碼品質與版本控制整合 ✅

### 4. 優化產出品質 ✅
- 在 `src/lib/compiler` 中整合 Prettier 或 AST 整理工具
- 確保產出的 Next.js / Express 程式碼完全符合人類工程師的撰寫習慣

### 5. Git 視覺化 Diff 介面 ✅
- 基於現有 `src/lib/diff/semantic-diff.ts`
- 實作 UI 面板：拉取 Git commits 時，畫布上綠色高亮新增節點、紅色標示刪除節點
- 讓 Code Review 在視覺化層面也能順利進行

### 6. 模組化節點庫 (Node Library) ✅
- 優化 `src/components/panels/NodeLibrary.tsx`
- 支援使用者把常用的一群節點打包成「自定義節點 (Custom Node)」
- 支援匯出 / 匯入，降低大型專案的畫面混亂度

---

## 階段三：生態系與 AI 深度融合 ✅

### 7. AI 雙向生成 ✅
- 目前 `src/hooks/use-ai-generate.ts` 偏向「根據 Prompt 生成初始流程圖」
- 下一步：
  - 「圈選部分節點 → 叫 AI 幫我重構這段邏輯」
  - 「貼上 Python/Node.js 程式碼 → AI 幫我轉成對應視覺化節點」

### 8. 沙盒環境 (API Sandbox) 強化 ✅
- `src/components/panels/ApiSandbox.tsx` 整合 Docker 或 WebContainer
- 在瀏覽器內直接點擊「執行」，真實測試編譯出的後端 API
- 不需先部署或切換到終端機

---

## 額外實作（非原始計畫）

### 9. VSCode Extension ✅
- 右鍵 Decompile / Compile
- Flow Preview SVG 視覺化
- Auto-Validation Diagnostics
- Custom Editor
- Status Bar 節點計數
- esbuild 打包

### 10. Playwright E2E 測試 ✅
- 20 個自動化 E2E 測試涵蓋 UI 與 API
- Chromium 瀏覽器自動啟動 dev server
