# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

如果你發現 flow2code 存在安全漏洞，請**不要**在公開 Issue 中回報。

### 回報方式

1. **GitHub Security Advisories**（推薦）  
   前往 [Security Advisories](../../security/advisories/new) 建立私人安全報告。

2. **Email**  
   發送詳細描述至維護者信箱（請見 package.json author 欄位）。

### 回報內容

- 漏洞描述與影響範圍
- 重現步驟（越詳細越好）
- 受影響的版本
- 可能的修復方案（如果有的話）

### 回應時間

- **確認收到**：48 小時內
- **初步評估**：7 天內
- **修復發布**：依嚴重程度，critical 漏洞 14 天內發布修復

### 安全相關功能

flow2code 內建以下安全機制：

- **IR Security Validator** (`validateIRSecurity()`) — 掃描 AI 生成的 IR 中的惡意代碼模式
- **Custom Code 危險 API 偵測** — 編譯時警告 `eval()`、`child_process`、`fs` 等危險呼叫
- **Content-Security-Policy** — Standalone dev server 設定 CSP headers
- **Body Size Limit** — API 端點限制 2MB 請求大小
- **Input Validation** — IR validator 驗證結構正確性（版本、節點、邊、環路偵測）

感謝你幫助 flow2code 保持安全！
