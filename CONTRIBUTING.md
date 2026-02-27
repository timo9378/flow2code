# Contributing to Flow2Code

感謝你有興趣為 Flow2Code 貢獻！

## 快速開始

```bash
# 1. Clone & Install
git clone https://github.com/timo9378/flow2code.git
cd flow2code
pnpm install

# 2. 開發 UI（含 Hot Reload）
pnpm dev

# 3. 執行測試
pnpm test:run

# 4. 建置 CLI + Compiler
pnpm build:cli
```

## 專案結構

```
src/
  lib/
    ir/            # FlowIR 型別定義 + 驗證器 + 拓撲排序
    compiler/      # AST 編譯器核心
      plugins/     # Node Plugin 系統（可擴充）
      platforms/   # Platform Adapter（Next.js / Express / Cloudflare）
    storage/       # .flow.json 分割/合併
    diff/          # Semantic Diff
  cli/             # CLI 工具（compile / watch / init）
  server/          # Standalone HTTP Server
  app/             # Next.js UI（Visual Canvas）
tests/             # Vitest 測試
```

## 開發流程

1. **建立 Branch** — `feat/xxx` 或 `fix/xxx`
2. **撰寫測試** — 所有編譯器變動必須有對應測試
3. **通過 CI** — `pnpm lint && pnpm test:run`
4. **發 PR** — 描述變動動機與影響

## 添加新的 Node Plugin

```typescript
// src/lib/compiler/plugins/builtin/my-plugin.ts
import type { NodePlugin } from "../types";

export const myPlugin: NodePlugin = {
  nodeType: "my_custom_action",
  generate(node, writer, ctx) {
    const varName = ctx.getVarName(node.id);
    writer.writeLine(`const ${varName} = doSomething();`);
    writer.writeLine(`flowState['${node.id}'] = ${varName};`);
  },
  getRequiredPackages() {
    return ["some-package"];
  },
};
```

然後在 `src/lib/compiler/plugins/builtin/index.ts` 中註冊。

## 添加新的 Platform Adapter

在 `src/lib/compiler/platforms/` 建立新檔案，實作 `PlatformAdapter` 介面，
然後在 `platforms/index.ts` 中註冊 `registerPlatform("myplatform", () => new MyPlatform())`。

## 測試規範

- 測試檔放在 `tests/` 目錄，使用 Vitest
- 命名格式：`*.test.ts`
- Compiler 測試建議使用 snapshot 或 `toContain()` 驗證生成代碼

## Commit Convention

```
feat: 新功能
fix: 修復 bug
refactor: 重構（不改變行為）
test: 新增或修改測試
docs: 文件變動
chore: 建構/CI/依賴更新
```

## 授權

貢獻的代碼將以 MIT License 發布。
