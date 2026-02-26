/**
 * Environment Variable Schema Validator
 *
 * 在編譯時期驗證所有 IR 中引用的環境變數是否已宣告。
 * 防止部署後才發現 process.env.XXXXX 是 undefined。
 *
 * 掃描策略：
 *   1. 掃描所有節點的字串參數，尋找 ${VAR_NAME} 模式
 *   2. 對比已宣告的環境變數（來自 .env / .env.example / 明確列表）
 *   3. 回傳缺失 / 未使用的環境變數警告
 */

import type { FlowIR, FlowNode } from "../ir/types";
import { ActionType } from "../ir/types";

// ============================================================
// Public API
// ============================================================

export interface EnvValidationResult {
  /** 驗證是否通過（無缺失變數） */
  valid: boolean;
  /** 在 IR 中被引用的所有環境變數 */
  usedVars: string[];
  /** 已宣告但未被使用的環境變數 */
  unusedVars: string[];
  /** 被引用但未宣告的環境變數 */
  missingVars: string[];
  /** 詳細的使用報告：變數名 → 引用位置 */
  usageMap: Map<string, EnvVarUsage[]>;
}

export interface EnvVarUsage {
  /** 引用此環境變數的節點 ID */
  nodeId: string;
  /** 節點 label */
  nodeLabel: string;
  /** 引用此環境變數的參數名稱 */
  paramKey: string;
}

// ============================================================
// Env Var Collection
// ============================================================

/** 匹配 ${VAR_NAME} 的 Regex（不含 process.env. 前綴） */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * 從 FlowIR 中掃描所有被引用的環境變數
 *
 * @param ir - Flow IR
 * @returns 環境變數名稱 → 使用位置 的映射
 */
export function collectEnvVars(ir: FlowIR): Map<string, EnvVarUsage[]> {
  const usageMap = new Map<string, EnvVarUsage[]>();

  for (const node of ir.nodes) {
    scanNodeParams(node, usageMap);
  }

  return usageMap;
}

/**
 * 掃描單個節點的所有參數
 */
function scanNodeParams(
  node: FlowNode,
  usageMap: Map<string, EnvVarUsage[]>
): void {
  const params = node.params as Record<string, unknown>;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      scanString(value, node, key, usageMap);
    } else if (typeof value === "object" && value !== null) {
      // 遞迴掃描巢狀物件（e.g. headers）
      scanObject(value as Record<string, unknown>, node, key, usageMap);
    }
  }
}

function scanString(
  str: string,
  node: FlowNode,
  paramKey: string,
  usageMap: Map<string, EnvVarUsage[]>
): void {
  let match: RegExpExecArray | null;
  // 必須 reset lastIndex（因為 global flag）
  ENV_VAR_PATTERN.lastIndex = 0;
  while ((match = ENV_VAR_PATTERN.exec(str)) !== null) {
    const varName = match[1];
    if (!usageMap.has(varName)) {
      usageMap.set(varName, []);
    }
    usageMap.get(varName)!.push({
      nodeId: node.id,
      nodeLabel: node.label,
      paramKey,
    });
  }
}

function scanObject(
  obj: Record<string, unknown>,
  node: FlowNode,
  parentKey: string,
  usageMap: Map<string, EnvVarUsage[]>
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = `${parentKey}.${key}`;
    if (typeof value === "string") {
      scanString(value, node, fullKey, usageMap);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      scanObject(value as Record<string, unknown>, node, fullKey, usageMap);
    }
  }
}

// ============================================================
// Validation
// ============================================================

/**
 * 驗證 IR 中的環境變數引用
 *
 * @param ir - Flow IR
 * @param declaredVars - 已宣告的環境變數名稱列表
 * @returns 驗證結果
 */
export function validateEnvVars(
  ir: FlowIR,
  declaredVars: string[]
): EnvValidationResult {
  const usageMap = collectEnvVars(ir);
  const usedVars = [...usageMap.keys()].sort();
  const declaredSet = new Set(declaredVars);

  const missingVars = usedVars.filter((v) => !declaredSet.has(v));
  const unusedVars = declaredVars
    .filter((v) => !usageMap.has(v))
    .sort();

  return {
    valid: missingVars.length === 0,
    usedVars,
    unusedVars,
    missingVars,
    usageMap,
  };
}

// ============================================================
// .env File Parsing
// ============================================================

/**
 * 從 .env 格式的字串中解析環境變數名稱
 * 支援格式：
 *   VAR_NAME=value
 *   VAR_NAME="value"
 *   # comment
 *   export VAR_NAME=value
 */
export function parseEnvFile(content: string): string[] {
  const vars: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // 跳過空行和註解
    if (!trimmed || trimmed.startsWith("#")) continue;

    // 移除 export 前綴
    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice(7).trim()
      : trimmed;

    // 提取變數名稱（= 之前的部分）
    const eqIndex = withoutExport.indexOf("=");
    if (eqIndex > 0) {
      const varName = withoutExport.slice(0, eqIndex).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
        vars.push(varName);
      }
    }
  }

  return vars;
}

/**
 * 格式化驗證結果為人類可讀的報告
 */
export function formatEnvValidationReport(result: EnvValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push(`✅ 環境變數驗證通過 (${result.usedVars.length} 個變數)`);
  } else {
    lines.push(`❌ 環境變數驗證失敗`);
    lines.push("");
    lines.push("缺失的環境變數：");
    for (const varName of result.missingVars) {
      const usages = result.usageMap.get(varName) ?? [];
      lines.push(`  ⚠️  ${varName}`);
      for (const usage of usages) {
        lines.push(
          `      → 被 "${usage.nodeLabel}" (${usage.nodeId}) 的 ${usage.paramKey} 引用`
        );
      }
    }
  }

  if (result.unusedVars.length > 0) {
    lines.push("");
    lines.push("💡 已宣告但未使用的環境變數：");
    for (const varName of result.unusedVars) {
      lines.push(`   ${varName}`);
    }
  }

  return lines.join("\n");
}
