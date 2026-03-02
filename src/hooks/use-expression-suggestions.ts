/**
 * useExpressionSuggestions — Expression input autocomplete
 *
 * Provides autocomplete suggestions for expression inputs based on upstream type information.
 * Includes:
 * - `flowState['nodeId']` — Output fields from upstream nodes
 * - `$trigger` / `$input` — Trigger-related variables
 * - Common methods (`.map()`, `.filter()`, `JSON.stringify()`, etc.)
 *
 * @example
 * ```tsx
 * function ExpressionInput({ nodeId, value, onChange }) {
 *   const { suggestions, filter, getFiltered } = useExpressionSuggestions(nodeId);
 *   const filtered = getFiltered(value); // Filter based on cursor position
 *   return <textarea value={value} onChange={onChange} />;
 * }
 * ```
 */

"use client";

import { useMemo } from "react";
import { useUpstreamTypes, type UpstreamTypes } from "./use-upstream-types";

// ── Types ──

export interface ExpressionSuggestion {
  /** Display text */
  label: string;
  /** Inserted code */
  insertText: string;
  /** Description */
  description: string;
  /** Category */
  kind: "variable" | "method" | "keyword" | "snippet";
  /** Sort weight (lower = higher priority) */
  sortOrder: number;
}

export interface ExpressionSuggestionsResult {
  /** All available suggestions */
  suggestions: ExpressionSuggestion[];
  /** Filter suggestions based on input prefix */
  getFiltered: (inputValue: string, cursorPosition?: number) => ExpressionSuggestion[];
  /** Upstream type information */
  upstreamTypes: UpstreamTypes;
}

// ── Static Suggestions ──

const BUILTIN_KEYWORDS: ExpressionSuggestion[] = [
  { label: "$trigger", insertText: "$trigger", description: "Trigger input data", kind: "keyword", sortOrder: 0 },
  { label: "$input", insertText: "$input", description: "Same as $trigger", kind: "keyword", sortOrder: 1 },
  { label: "flowState", insertText: "flowState", description: "Flow state object (upstream node outputs)", kind: "keyword", sortOrder: 2 },
];

const COMMON_METHODS: ExpressionSuggestion[] = [
  { label: ".map()", insertText: ".map((item) => )", description: "Iterate and transform array", kind: "method", sortOrder: 100 },
  { label: ".filter()", insertText: ".filter((item) => )", description: "Filter array elements", kind: "method", sortOrder: 101 },
  { label: ".find()", insertText: ".find((item) => )", description: "Find the first matching element", kind: "method", sortOrder: 102 },
  { label: ".length", insertText: ".length", description: "Array or string length", kind: "method", sortOrder: 103 },
  { label: ".toString()", insertText: ".toString()", description: "Convert to string", kind: "method", sortOrder: 104 },
  { label: ".includes()", insertText: ".includes()", description: "Whether it contains the specified value", kind: "method", sortOrder: 105 },
  { label: ".join()", insertText: ".join(', ')", description: "Join array into string", kind: "method", sortOrder: 106 },
  { label: ".slice()", insertText: ".slice(0, )", description: "Get subset", kind: "method", sortOrder: 107 },
];

const COMMON_SNIPPETS: ExpressionSuggestion[] = [
  { label: "JSON.stringify()", insertText: "JSON.stringify()", description: "Serialize object to JSON string", kind: "snippet", sortOrder: 200 },
  { label: "JSON.parse()", insertText: "JSON.parse()", description: "Parse JSON string to object", kind: "snippet", sortOrder: 201 },
  { label: "Object.keys()", insertText: "Object.keys()", description: "Get all keys of an object", kind: "snippet", sortOrder: 202 },
  { label: "Object.values()", insertText: "Object.values()", description: "Get all values of an object", kind: "snippet", sortOrder: 203 },
  { label: "Object.entries()", insertText: "Object.entries()", description: "Get [key, value] pairs of an object", kind: "snippet", sortOrder: 204 },
  { label: "Date.now()", insertText: "Date.now()", description: "Current timestamp (milliseconds)", kind: "snippet", sortOrder: 205 },
  { label: "new Date().toISOString()", insertText: "new Date().toISOString()", description: "ISO date string", kind: "snippet", sortOrder: 206 },
  { label: "Math.round()", insertText: "Math.round()", description: "Round to nearest integer", kind: "snippet", sortOrder: 207 },
  { label: "Number()", insertText: "Number()", description: "Convert to number", kind: "snippet", sortOrder: 208 },
  { label: "String()", insertText: "String()", description: "Convert to string", kind: "snippet", sortOrder: 209 },
  { label: "Boolean()", insertText: "Boolean()", description: "Convert to boolean", kind: "snippet", sortOrder: 210 },
  { label: "Array.isArray()", insertText: "Array.isArray()", description: "Check if value is an array", kind: "snippet", sortOrder: 211 },
];

// ── Hook ──

/**
 * Provides autocomplete suggestions for expression inputs
 *
 * @param selectedNodeId - Currently selected node ID
 */
export function useExpressionSuggestions(
  selectedNodeId: string | null
): ExpressionSuggestionsResult {
  const upstreamTypes = useUpstreamTypes(selectedNodeId);

  const suggestions = useMemo(() => {
    const items: ExpressionSuggestion[] = [...BUILTIN_KEYWORDS];

    // Generate flowState field suggestions from upstream types
    for (const entry of upstreamTypes.entries) {
      items.push({
        label: `flowState['${entry.nodeId}']`,
        insertText: `flowState['${entry.nodeId}']`,
        description: `${entry.label} (${entry.tsType})`,
        kind: "variable",
        sortOrder: 10,
      });
    }

    // Add common methods and snippets
    items.push(...COMMON_METHODS);
    items.push(...COMMON_SNIPPETS);

    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [upstreamTypes]);

  const getFiltered = useMemo(() => {
    return (inputValue: string, cursorPosition?: number) => {
      // Get text before cursor position
      const pos = cursorPosition ?? inputValue.length;
      const beforeCursor = inputValue.slice(0, pos);

      // Find the last "start" position (text after spaces, newlines, operators, etc.)
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
