# Flow2Code v0.3.0 Roadmap

## 🎯 主題：架構統一、開發體驗、正式生態系

---

## 階段一：架構統一與品質強化

### 1. 統一 API Handler 架構
- 消除 `src/app/api/*/route.ts` 與 `src/server/handlers.ts` 的重複邏輯
- Next.js API routes 改為薄包裝層，實際邏輯全部委派給 `handlers.ts`
- 降低維護風險與程式碼漂移

### 2. Bundle 優化
- 修正 `tsup.config.ts`，外部化 `ts-morph` 傳遞依賴（picomatch、micromatch、fast-glob 等）
- 目標：`server.js` / `cli.js` 從 5.5MB → ~200KB
- 啟用 `splitting: true` 讓 CLI 與 Server 共享 chunk

### 3. TypeScript 嚴格模式增強
- 啟用 `noUncheckedIndexedAccess: true`
- ESLint `no-explicit-any` 從 `warn` 改為 `error`
- 消除所有 `any` 型別殘留

### 4. Tailwind CSS v4 遷移
- 修正 27 個 arbitrary value lint 警告
- 統一使用 Tailwind v4 utility classes

---

## 階段二：測試與 CI/CD 完善

### 5. GitHub Actions CI Pipeline
- Node 20/22 矩陣測試
- Lint → Unit Test → E2E Test → Build → Publish 自動化
- 覆蓋率報告整合 (Vitest coverage)

### 6. Playwright E2E 增強
- 啟用並行測試 (`workers: auto`)
- 新增 Visual Regression 測試（截圖比對）
- 新增 Server Endpoint 整合測試

### 7. 測試覆蓋率目標
- 單元測試：維持 413+ 測試，覆蓋率 > 85%
- E2E 測試：增加至 40+ 測試場景

---

## 階段三：功能擴展

### 8. 多流程專案管理
- 擴展 `src/lib/storage/flow-project.ts`
- 支援單一專案內管理多個 `.flow.json`
- 專案級別的編譯與部署

### 9. 流程版本歷史
- 基於現有 `src/lib/diff/semantic-diff.ts`
- 實作流程版本時間軸
- 視覺化顯示各版本差異（新增/刪除/修改的節點）

### 10. OpenAPI 完善
- 實作 tag-based 過濾（目前為 TODO stub）
- 支援 OpenAPI 3.1 完整規格
- 自動生成 request/response 型別

### 11. 認證/授權節點
- 新增 OAuth2、JWT、API Key 節點類型
- 安全環境變數管理（超越現有 env-validator）
- 中間件模式支援

---

## 階段四：部署與生態系

### 12. Docker 容器化
- 新增 Dockerfile 與 docker-compose.yml
- 一鍵自架設 Flow2Code 服務
- 多階段建構優化映像大小

### 13. 設定檔支援
- 新增 `flow2code.config.ts` / `.flow2coderc`
- 專案級別自訂編譯行為、預設平台、插件清單
- CLI 自動偵測設定檔

### 14. 插件生態系
- 公開 Plugin API，允許第三方節點類型
- npm `flow2code-plugin-*` 命名慣例
- 插件註冊表與文件

### 15. 節點即時資料預覽
- 在畫布節點上顯示 Mock 回應資料
- API Sandbox 結果內嵌顯示
- 支援斷點調試模式

---

## 優先順序總覽

| 優先級 | 項目 | 預期影響 |
|--------|------|----------|
| P0 | 統一 API Handler 架構 | 消除維護風險 |
| P0 | Bundle 優化 | npm 安裝大小減少 95% |
| P1 | GitHub Actions CI | 自動化品質保證 |
| P1 | TypeScript 嚴格模式 | 減少執行時期錯誤 |
| P1 | 流程版本歷史 | 使用者最需要的功能之一 |
| P2 | Docker 容器化 | 簡化部署 |
| P2 | 多流程專案管理 | 大型專案支援 |
| P2 | 插件生態系 | 社區擴展能力 |
| P3 | 認證節點 | 企業級功能 |
| P3 | 資料預覽 | 開發體驗提升 |
