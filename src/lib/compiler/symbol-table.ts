/**
 * Flow2Code Symbol Table
 *
 * 將節點 ID 映射為人類可讀的變數名稱（源自節點 label）。
 * 實現「可 Eject」的代碼生成 —— 生成的 TypeScript 看起來像手寫代碼。
 *
 * 命名策略：
 *   "GET /api/hello"          → getApiHello
 *   "Fetch Available Models"  → fetchAvailableModels
 *   "Return Hello"            → returnHello
 *   "Check Valid"             → checkValid
 *   "Call External API"       → callExternalApi
 *
 * 衝突解決：同名變數自動加後綴 _2, _3 ...
 * 保留字保護：JS/TS 保留字 + 生成代碼常用標識符自動加 Result 後綴
 */

import type { FlowIR, NodeId } from "../ir/types";

// ============================================================
// Public API
// ============================================================

export interface SymbolTable {
  /** 取得節點對應的人類可讀變數名稱 */
  getVarName(nodeId: NodeId): string;
  /** 檢查節點是否有命名變數 */
  hasVar(nodeId: NodeId): boolean;
  /** 取得所有映射 */
  getAllMappings(): ReadonlyMap<NodeId, string>;
}

/**
 * 根據 FlowIR 中的所有節點 label 建構 Symbol Table。
 * 每個節點 ID 會被映射為唯一的 camelCase 變數名稱。
 */
export function buildSymbolTable(ir: FlowIR): SymbolTable {
  const mappings = new Map<NodeId, string>();
  const usedNames = new Set<string>();

  for (const node of ir.nodes) {
    let name = labelToVarName(node.label);

    // 保護保留字
    if (!name || RESERVED_WORDS.has(name)) {
      name = `${name || "node"}Result`;
    }

    // 確保以字母或底線開頭
    if (/^[0-9]/.test(name)) {
      name = `_${name}`;
    }

    // 衝突解決
    let uniqueName = name;
    let counter = 2;
    while (usedNames.has(uniqueName)) {
      uniqueName = `${name}${counter}`;
      counter++;
    }

    usedNames.add(uniqueName);
    mappings.set(node.id, uniqueName);
  }

  return {
    getVarName(nodeId: NodeId): string {
      return (
        mappings.get(nodeId) ??
        `node_${nodeId.replace(/[^a-zA-Z0-9_]/g, "_")}`
      );
    },
    hasVar(nodeId: NodeId): boolean {
      return mappings.has(nodeId);
    },
    getAllMappings(): ReadonlyMap<NodeId, string> {
      return mappings;
    },
  };
}

// ============================================================
// Label → camelCase 轉換
// ============================================================

/**
 * 將使用者可見的節點 label 轉換為 camelCase 變數名稱。
 *
 * @example
 * labelToVarName("GET /api/hello")        // "getApiHello"
 * labelToVarName("Fetch Available Models") // "fetchAvailableModels"
 * labelToVarName("Call External API")      // "callExternalApi"
 */
export function labelToVarName(label: string): string {
  const cleaned = label
    .replace(/[\/\-_\.]/g, " ") // 斜線、連字號、底線、點 → 空格
    .replace(/[^a-zA-Z0-9\s]/g, "") // 移除其他特殊字元
    .trim();

  if (!cleaned) return "";

  const words = cleaned
    .replace(/([a-z])([A-Z])/g, "$1 $2") // 拆分 camelCase 邊界
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return "";

  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

// ============================================================
// 保留字集合
// ============================================================

const RESERVED_WORDS = new Set([
  // JavaScript 保留字
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "async",
  // 內建全域值
  "undefined", "null", "true", "false", "NaN", "Infinity",
  // 生成代碼中常用的標識符（避免遮蔽）
  "req", "res", "body", "query", "data", "result", "response", "error",
  "flowState", "searchParams", "NextResponse", "NextRequest",
]);
