/**
 * AI 生成 IR 安全檢查
 *
 * 當 IR 由 AI/LLM 產生時，custom_code 節點可能包含惡意代碼。
 * 此模組在「載入/匯入」階段即攔截，比編譯時的 `DANGEROUS_CODE_PATTERNS` 更早。
 *
 * @example
 * ```ts
 * import { validateIRSecurity } from "flow2code/compiler";
 *
 * const result = validateIRSecurity(aiGeneratedIR);
 * if (!result.safe) {
 *   console.warn("⚠️ Dangerous patterns:", result.findings);
 * }
 * ```
 */

import type { FlowIR, FlowNode, NodeId } from "./types";
import { ActionType } from "./types";

// ── Types ──

export interface SecurityFinding {
  /** 嚴重性等級 */
  severity: "critical" | "warning" | "info";
  /** 節點 ID */
  nodeId: NodeId;
  /** 節點標籤 */
  nodeLabel: string;
  /** 偵測到的模式描述 */
  pattern: string;
  /** 匹配到的代碼片段 (截斷至 80 字元) */
  match: string;
}

export interface SecurityCheckResult {
  /** 是否安全（沒有 critical findings） */
  safe: boolean;
  /** 所有偵測結果 */
  findings: SecurityFinding[];
  /** 掃描的節點數 */
  nodesScanned: number;
}

// ── Dangerous Patterns ──

interface DangerousPattern {
  pattern: RegExp;
  desc: string;
  severity: SecurityFinding["severity"];
}

/**
 * 危險代碼模式清單
 *
 * 分三級：
 * - critical: 直接威脅系統安全（RCE, 檔案刪除等）
 * - warning: 可能有安全隱患（動態 import, 網路通訊等）
 * - info: 值得注意但不一定危險
 */
const SECURITY_PATTERNS: DangerousPattern[] = [
  // ── Critical: Remote Code Execution / System Access ──
  { pattern: /\beval\s*\(/, desc: "eval() — 動態執行任意代碼", severity: "critical" },
  { pattern: /\bnew\s+Function\s*\(/, desc: "new Function() — 動態建構函式", severity: "critical" },
  { pattern: /\bchild_process\b/, desc: "child_process — 可執行任意系統指令", severity: "critical" },
  { pattern: /\bexec\s*\(/, desc: "exec() — 執行 shell 指令", severity: "critical" },
  { pattern: /\bexecSync\s*\(/, desc: "execSync() — 同步執行 shell 指令", severity: "critical" },
  { pattern: /\bspawn\s*\(/, desc: "spawn() — 產生子進程", severity: "critical" },
  { pattern: /\bprocess\.exit\b/, desc: "process.exit() — 終止 Node.js 進程", severity: "critical" },
  { pattern: /\bprocess\.env\b/, desc: "process.env — 存取環境變數（可能洩漏密鑰）", severity: "critical" },
  { pattern: /\bprocess\.kill\b/, desc: "process.kill() — 終止進程", severity: "critical" },
  { pattern: /\brequire\s*\(\s*['"`]child_process/, desc: "require('child_process')", severity: "critical" },
  { pattern: /\brequire\s*\(\s*['"`]vm['"`]/, desc: "require('vm') — V8 虛擬機", severity: "critical" },

  // ── Critical: File System Destructive ──
  { pattern: /\bfs\.\w*(unlink|rmdir|rm|rmSync|unlinkSync)\b/, desc: "fs 刪除操作", severity: "critical" },
  { pattern: /\bfs\.\w*(writeFile|writeFileSync|appendFile)\b/, desc: "fs 寫入操作", severity: "critical" },
  { pattern: /\brequire\s*\(\s*['"`]fs['"`]\)/, desc: "require('fs') — 檔案系統存取", severity: "critical" },

  // ── Warning: Network / Dynamic Import ──
  { pattern: /\bimport\s*\(/, desc: "動態 import() — 可載入任意模組", severity: "warning" },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]/, desc: "require('http/https') — 網路模組", severity: "warning" },
  { pattern: /\brequire\s*\(\s*['"`]net['"`]/, desc: "require('net') — 低階網路存取", severity: "warning" },
  { pattern: /\bglobalThis\b/, desc: "globalThis — 存取全域作用域", severity: "warning" },
  { pattern: /\b__proto__\b/, desc: "__proto__ — 原型鏈汙染風險", severity: "warning" },
  { pattern: /\bconstructor\s*\[\s*['"`]/, desc: "constructor[] — 原型鏈汙染風險", severity: "warning" },

  // ── Warning: FS Read (non-destructive but sensitive) ──
  { pattern: /\brequire\s*\(\s*['"`]fs['"`]\s*\)\.read/, desc: "fs 讀取操作", severity: "warning" },
  { pattern: /\bfs\.\w*(readFile|readFileSync|readdir)\b/, desc: "fs 讀取操作", severity: "warning" },

  // ── Info: Uncommon patterns ──
  { pattern: /\bsetTimeout\s*\(\s*[^,]+,\s*\d{5,}/, desc: "長時間 setTimeout (>10s) — 可能是惡意延遲", severity: "info" },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, desc: "while(true) — 可能的無限迴圈", severity: "info" },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, desc: "for(;;) — 可能的無限迴圈", severity: "info" },
];

// ── Core Scanner ──

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

/**
 * 掃描單一節點的代碼字串
 */
function scanCode(
  nodeId: NodeId,
  nodeLabel: string,
  code: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const { pattern, desc, severity } of SECURITY_PATTERNS) {
    const match = pattern.exec(code);
    if (match) {
      findings.push({
        severity,
        nodeId,
        nodeLabel,
        pattern: desc,
        match: truncate(match[0], 80),
      });
    }
  }

  return findings;
}

/**
 * 從 FlowNode 擷取可執行代碼字串
 * 目前掃描：
 * - custom_code.code
 * - transform.expression
 * - 所有 params 中包含可疑字串的欄位
 */
function extractCodeFields(node: FlowNode): string[] {
  const codes: string[] = [];
  const params = node.params as Record<string, unknown> | undefined;

  if (!params) return codes;

  // custom_code 的 code 欄位
  if (node.nodeType === ActionType.CUSTOM_CODE && typeof params.code === "string") {
    codes.push(params.code);
  }

  // transform 的 expression 欄位
  if (typeof params.expression === "string") {
    codes.push(params.expression);
  }

  // call_subflow 的 inputMapping（JSON 字串中可能藏代碼）
  if (typeof params.inputMapping === "string") {
    codes.push(params.inputMapping);
  } else if (typeof params.inputMapping === "object" && params.inputMapping !== null) {
    codes.push(JSON.stringify(params.inputMapping));
  }

  // body 欄位 (fetch_api 等)
  if (typeof params.body === "string") {
    codes.push(params.body);
  }

  // SQL query 中的字串插值
  if (typeof params.query === "string") {
    codes.push(params.query);
  }

  // bodyExpression (return_response)
  if (typeof params.bodyExpression === "string") {
    codes.push(params.bodyExpression);
  }

  // condition (if_else)
  if (typeof params.condition === "string") {
    codes.push(params.condition);
  }

  return codes;
}

// ── Public API ──

/**
 * 驗證 FlowIR 中所有節點的安全性
 *
 * 特別針對 AI/LLM 產生的 IR，在載入或匯入階段即偵測惡意模式。
 * 掃範圍：custom_code, transform, if_else, return_response, fetch_api 等所有含代碼/表達式的欄位。
 *
 * @param ir - 待檢查的 FlowIR
 * @returns SecurityCheckResult - 包含安全性判斷、所有偵查結果、掃描統計
 */
export function validateIRSecurity(ir: FlowIR): SecurityCheckResult {
  const findings: SecurityFinding[] = [];
  let nodesScanned = 0;

  for (const node of ir.nodes) {
    const codeFields = extractCodeFields(node);
    if (codeFields.length === 0) continue;

    nodesScanned++;

    for (const code of codeFields) {
      const nodeFindings = scanCode(node.id, node.label ?? node.id, code);
      findings.push(...nodeFindings);
    }
  }

  const hasCritical = findings.some((f) => f.severity === "critical");

  return {
    safe: !hasCritical,
    findings,
    nodesScanned,
  };
}

/**
 * 格式化安全檢查結果為人類可讀字串
 */
export function formatSecurityReport(result: SecurityCheckResult): string {
  if (result.findings.length === 0) {
    return `✅ 安全檢查通過 (掃描 ${result.nodesScanned} 個節點，未偵測到危險模式)`;
  }

  const lines: string[] = [];
  const critical = result.findings.filter((f) => f.severity === "critical");
  const warnings = result.findings.filter((f) => f.severity === "warning");
  const infos = result.findings.filter((f) => f.severity === "info");

  lines.push(`⚠️ 安全檢查結果 (掃描 ${result.nodesScanned} 個節點)`);
  lines.push("");

  if (critical.length > 0) {
    lines.push(`🔴 Critical (${critical.length}):`);
    for (const f of critical) {
      lines.push(`  [${f.nodeId}] ${f.pattern} — match: "${f.match}"`);
    }
  }

  if (warnings.length > 0) {
    lines.push(`🟡 Warning (${warnings.length}):`);
    for (const f of warnings) {
      lines.push(`  [${f.nodeId}] ${f.pattern} — match: "${f.match}"`);
    }
  }

  if (infos.length > 0) {
    lines.push(`🔵 Info (${infos.length}):`);
    for (const f of infos) {
      lines.push(`  [${f.nodeId}] ${f.pattern} — match: "${f.match}"`);
    }
  }

  return lines.join("\n");
}
