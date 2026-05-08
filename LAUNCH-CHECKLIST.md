# Flow2Code 開源發布完整 Checklist

> 第一次開源的完整流程，按順序執行。

---

## Phase 0：發布前準備（你現在就做）

### GitHub 設定
- [ ] 確認 repo 是 **Public**（Settings → General → Danger Zone → Change visibility）
- [ ] 設定 **About**（repo 右上角齒輪）：
  - Description: `X-ray vision for your backend code — decompile TypeScript into visual flows, edit on canvas, export clean code`
  - Website: `https://flow2code.koimsurai.com`
  - Topics: `typescript`, `compiler`, `decompiler`, `devtools`, `visual-programming`, `ast`, `code-audit`, `nextjs`
- [ ] 設定 **Social Preview**（Settings → 上傳 1280x640 的 OG image）
  - 用 Figma/Canva 做一張：左邊是 TypeScript 程式碼，右邊是視覺化 flow 圖，中間箭頭
  - 這張圖會在 Twitter/Slack/Discord 分享時顯示

### Playground 部署（自架 Server）

Flow2Code 的 Playground 需要後端 API（ts-morph 無法在瀏覽器跑），所以架在你的 server 比 GitHub Pages 好。

**Step 1：Cloudflare DNS**
- [ ] 登入 Cloudflare Dashboard → koimsurai.com → DNS
- [ ] Add Record：
  - Type: **A**
  - Name: **flow2code**
  - IPv4: **114.35.36.163**
  - Proxy status: **Proxied**（橘色雲，提供 CDN + SSL + DDoS 防護）

**Step 2：Nginx 設定**
- [ ] 複製 nginx config：
  ```bash
  sudo cp ~/Server/flow2code/deploy/nginx-flow2code.conf /etc/nginx/sites-available/flow2code-koimsurai
  sudo ln -s /etc/nginx/sites-available/flow2code-koimsurai /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  ```

**Step 3：啟動 Flow2Code Server**
- [ ] 確認使用 Node 20+（你的系統 Node 是 18，需要切到 nvm）：
  ```bash
  # 確認 nvm 可用
  export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm use 20
  
  # Build 專案
  cd ~/Server/flow2code
  pnpm build
  ```
- [ ] 安裝 systemd service（開機自動啟動）：
  ```bash
  sudo cp ~/Server/flow2code/deploy/flow2code.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable flow2code
  sudo systemctl start flow2code
  
  # 確認運行狀態
  sudo systemctl status flow2code
  ```

**Step 4：驗證**
- [ ] 開啟 `https://flow2code.koimsurai.com` 確認 UI 載入正常
- [ ] 測試 Compile / Decompile 功能正常運作

### Demo GIF 錄製
- [ ] 安裝錄屏工具：[Kap](https://getkap.co/)（Mac）或 [Peek](https://github.com/phw/peek)（Linux）或 [ScreenToGif](https://www.screentogif.com/)（Windows）
- [ ] 錄製 30 秒 demo：
  1. 開啟 playground
  2. 貼上一段 AI 生成的 Next.js API route（有 if/else、fetch、try/catch）
  3. 點擊 Decompile → 看到視覺化 flow
  4. 在 canvas 上做一個修改（加節點或改連線）
  5. 點擊 Compile → 看到更新的 TypeScript
- [ ] 壓縮 GIF（目標 < 5MB）：`ffmpeg -i demo.gif -vf "fps=15,scale=800:-1" docs/assets/demo.gif`
- [ ] 放到 `docs/assets/demo.gif`
- [ ] 取消 README.md 裡的 GIF 註解（移除 `<!-- -->` 包裹）

### npm 發布
- [ ] 確認 `pnpm build` 成功
- [ ] `pnpm publish --access public`（發布 v0.3.0）

---

## Phase 1：首次發布宣傳（Day 1）

### Twitter / X
- [ ] 發一條推文，格式建議：

```
I built an X-ray for backend code.

Paste any TypeScript API route → see it as a visual flow in 2 seconds.

- Decompile any TS → editable visual DAG
- Fix issues on the canvas
- Export clean, zero-dependency TypeScript

Open source, MIT licensed.

🔗 https://flow2code.koimsurai.com

[附上 demo GIF]
```

### Reddit
- [ ] 發到 r/typescript：「Show r/typescript: I built a decompiler that turns any TypeScript API route into a visual flow」
- [ ] 發到 r/webdev：同上，強調 "audit AI-generated code visually"
- [ ] 發到 r/nextjs：強調 Next.js App Router 支援

### Hacker News
- [ ] 標題：`Show HN: Flow2Code – X-ray vision for TypeScript API routes`
- [ ] 時間：美西時間週二或週三早上 8-10 點（最佳曝光時段）
- [ ] 第一則回覆自己寫背景故事（為什麼做、技術亮點、跟 n8n 的差異）

### Dev.to / Hashnode
- [ ] 寫一篇 1000-1500 字的文章：
  - 標題：「Why I built a decompiler for AI-generated TypeScript」
  - 結構：痛點 → 解法 → 技術實作（IR、ts-morph）→ Demo → 連結
  - 附上 demo GIF + playground 連結

### Discord / Slack
- [ ] 發到 TypeScript Discord #showcase
- [ ] 發到 Next.js Discord #showcase
- [ ] 發到 React Flow Discord（你用了他們的套件，他們通常會轉發 showcase）

---

## Phase 2：持續維護（Week 1-4）

### 社群回應
- [ ] 即時回覆 GitHub Issues（24 小時內回覆）
- [ ] 對 Star 數做觀察：如果某篇貼文帶來大量流量，加碼在那個平台發更多內容
- [ ] 感謝前 10 個 contributor（即使只是報 bug）

### 迭代優先順序
1. 修社群回報的 bug（最高優先，快速回應建立信任）
2. 改善 decompiler 準確度（核心賣點）
3. 加入 `flow2code.config.ts`（降低使用摩擦）
4. 寫 "How to create a custom plugin" 教學（開放生態）

### 持續內容
- [ ] 每週發一條推文展示一個使用場景
- [ ] 收集真實用戶的 flow 截圖（取得授權後）放到 README 的 "Used By" section
- [ ] 找 YouTube DevTool reviewer 做 demo（Theo, Fireship, Web Dev Simplified 等）

---

## 常見問題

### Q: 需要 LICENSE 檔案嗎？
你已經有 MIT LICENSE 了，沒問題。

### Q: 怎麼處理 Issue 和 PR？
- 用 Label 分類：`bug`, `enhancement`, `good first issue`, `help wanted`
- `good first issue` 標籤會讓新手 contributor 更容易參與
- PR 模板你已經有了（`.github/PULL_REQUEST_TEMPLATE.md`）

### Q: 要不要用 Release / Tag？
- 是的。每次 `pnpm publish` 後，也在 GitHub 建立一個 Release：
  ```bash
  git tag v0.3.0
  git push origin v0.3.0
  ```
  然後到 GitHub Releases 頁面 → Draft a new release → 選 tag → 貼 CHANGELOG 內容

### Q: npm scope 怎麼辦？
- 目前 `@timo9378/flow2code` 可以先用
- 建議建立 npm org `@flow2code`（https://www.npmjs.com/org/create）
- 之後遷移到 `@flow2code/core`，舊 package 發一個 deprecated 版本指向新名稱

### Q: 怎麼衡量成效？
- GitHub Stars：最直觀
- npm weekly downloads：實際使用量
- GitHub Traffic（Insights → Traffic）：看 README 被瀏覽次數
- 目標：發布首週 50+ stars = 有共鳴，100+ = 值得全力投入
