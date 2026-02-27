/**
 * useExpressionSuggestions — 表達式輸入框自動補全
 *
 * 根據上游型別資訊，提供表達式輸入的自動補全建議。
 * 包含：
 * - `flowState['nodeId']` — 上游節點的輸出欄位
 * - `$trigger` / `$input` — 觸發器相關變數
 * - 常用方法（`.map()`, `.filter()`, `JSON.stringify()` 等）
 *
 * @example
 * ```tsx
 * function ExpressionInput({ nodeId, value, onChange }) {
 *   const { suggestions, filter, getFiltered } = useExpressionSuggestions(nodeId);
 *   const filtered = getFiltered(value); // 依據游標位置過濾
 *   return <textarea value={value} onChange={onChange} />;
 * }
 * ```
 */

"use client";

import { useMemo } from "react";
import { useUpstreamTypes, type UpstreamTypes } from "./use-upstream-types";

// ── Types ──

export interface ExpressionSuggestion {
  /** 顯示文字 */
  label: string;
  /** 插入的代碼 */
  insertText: string;
  /** 說明 */
  description: string;
  /** 分類 */
  kind: "variable" | "method" | "keyword" | "snippet";
  /** 排序權重（越小越靠前） */
  sortOrder: number;
}

export interface ExpressionSuggestionsResult {
  /** 所有可用建議 */
  suggestions: ExpressionSuggestion[];
  /** 根據輸入前綴過濾建議 */
  getFiltered: (inputValue: string, cursorPosition?: number) => ExpressionSuggestion[];
  /** 上游型別資訊 */
  upstreamTypes: UpstreamTypes;
}

// ── Static Suggestions ──

const BUILTIN_KEYWORDS: ExpressionSuggestion[] = [
  { label: "$trigger", insertText: "$trigger", description: "觸發器輸入資料", kind: "keyword", sortOrder: 0 },
  { label: "$input", insertText: "$input", description: "與 $trigger 相同", kind: "keyword", sortOrder: 1 },
  { label: "flowState", insertText: "flowState", description: "流程狀態物件 (上游節點輸出)", kind: "keyword", sortOrder: 2 },
];

const COMMON_METHODS: ExpressionSuggestion[] = [
  { label: ".map()", insertText: ".map((item) => )", description: "遍歷陣列並轉換", kind: "method", sortOrder: 100 },
  { label: ".filter()", insertText: ".filter((item) => )", description: "過濾陣列元素", kind: "method", sortOrder: 101 },
  { label: ".find()", insertText: ".find((item) => )", description: "找到第一個符合的元素", kind: "method", sortOrder: 102 },
  { label: ".length", insertText: ".length", description: "陣列或字串長度", kind: "method", sortOrder: 103 },
  { label: ".toString()", insertText: ".toString()", description: "轉換為字串", kind: "method", sortOrder: 104 },
  { label: ".includes()", insertText: ".includes()", description: "是否包含指定值", kind: "method", sortOrder: 105 },
  { label: ".join()", insertText: ".join(', ')", description: "陣列合併為字串", kind: "method", sortOrder: 106 },
  { label: ".slice()", insertText: ".slice(0, )", description: "取子集", kind: "method", sortOrder: 107 },
];

const COMMON_SNIPPETS: ExpressionSuggestion[] = [
  { label: "JSON.stringify()", insertText: "JSON.stringify()", description: "將物件序列化為 JSON 字串", kind: "snippet", sortOrder: 200 },
  { label: "JSON.parse()", insertText: "JSON.parse()", description: "解析 JSON 字串為物件", kind: "snippet", sortOrder: 201 },
  { label: "Object.keys()", insertText: "Object.keys()", description: "取得物件的所有鍵", kind: "snippet", sortOrder: 202 },
  { label: "Object.values()", insertText: "Object.values()", description: "取得物件的所有值", kind: "snippet", sortOrder: 203 },
  { label: "Object.entries()", insertText: "Object.entries()", description: "取得物件的 [key, value] 陣列", kind: "snippet", sortOrder: 204 },
  { label: "Date.now()", insertText: "Date.now()", description: "當前時間戳 (毫秒)", kind: "snippet", sortOrder: 205 },
  { label: "new Date().toISOString()", insertText: "new Date().toISOString()", description: "ISO 日期字串", kind: "snippet", sortOrder: 206 },
  { label: "Math.round()", insertText: "Math.round()", description: "四捨五入", kind: "snippet", sortOrder: 207 },
  { label: "Number()", insertText: "Number()", description: "轉換為數字", kind: "snippet", sortOrder: 208 },
  { label: "String()", insertText: "String()", description: "轉換為字串", kind: "snippet", sortOrder: 209 },
  { label: "Boolean()", insertText: "Boolean()", description: "轉換為布林值", kind: "snippet", sortOrder: 210 },
  { label: "Array.isArray()", insertText: "Array.isArray()", description: "判斷是否為陣列", kind: "snippet", sortOrder: 211 },
];

// ── Hook ──

/**
 * 提供表達式輸入的自動補全建議
 *
 * @param selectedNodeId - 目前選中的節點 ID
 */
export function useExpressionSuggestions(
  selectedNodeId: string | null
): ExpressionSuggestionsResult {
  const upstreamTypes = useUpstreamTypes(selectedNodeId);

  const suggestions = useMemo(() => {
    const items: ExpressionSuggestion[] = [...BUILTIN_KEYWORDS];

    // 從上游型別生成 flowState 欄位建議
    for (const entry of upstreamTypes.entries) {
      items.push({
        label: `flowState['${entry.nodeId}']`,
        insertText: `flowState['${entry.nodeId}']`,
        description: `${entry.label} (${entry.tsType})`,
        kind: "variable",
        sortOrder: 10,
      });
    }

    // 添加通用方法和片段
    items.push(...COMMON_METHODS);
    items.push(...COMMON_SNIPPETS);

    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [upstreamTypes]);

  const getFiltered = useMemo(() => {
    return (inputValue: string, cursorPosition?: number) => {
      // 取得游標位置之前的文字
      const pos = cursorPosition ?? inputValue.length;
      const beforeCursor = inputValue.slice(0, pos);

      // 找到最後一個「開始」位置（空格、換行、運算符等後面的文字）
      const tokenMatch = /[\w$.'[\]]*$/.exec(beforeCursor);
      const prefix = tokenMatch ? tokenMatch[0].toLowerCase() : "";

      if (!prefix) return suggestions;

      return suggestions.filter(
        (s) =>
          s.label.toLowerCase().includes(prefix) ||
          s.insertText.toLowerCase().includes(prefix)
      );
    };
  }, [suggestions]);

  return { suggestions, getFiltered, upstreamTypes };
}
