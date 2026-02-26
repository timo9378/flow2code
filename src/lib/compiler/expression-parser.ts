/**
 * Flow2Code Expression Parser
 *
 * 替代脆弱的 Regex 解析，使用 Recursive Descent Parser 正確處理模板表達式。
 *
 * 支援語法：
 *   {{nodeId}}                → flowState['nodeId']
 *   {{nodeId.path.to.value}}  → flowState['nodeId'].path.to.value
 *   {{nodeId.arr[0].name}}    → flowState['nodeId'].arr[0].name
 *   {{$input}}                → 自動解析上游非觸發器節點
 *   {{$input.data.items}}     → 同上，帶子路徑
 *   {{$trigger}}              → 觸發器節點的 flowState
 *   {{$trigger.body.userId}}  → flowState['triggerId'].body.userId
 *
 * 與 Regex 版的差異：
 *   - 正確處理嵌套括號 e.g. {{node.arr[items[0]]}}
 *   - 正確處理空白 e.g. {{ $input.data }}
 *   - 報錯訊息清晰，不會靜默 fallthrough
 *   - 支援逃脫序列 \\{{ 輸出字面 {{
 */

import type { FlowIR, FlowNode, NodeId } from "../ir/types";
import { NodeCategory } from "../ir/types";
import type { SymbolTable } from "./symbol-table";

// ============================================================
// Parser Types
// ============================================================

export interface ExpressionContext {
  /** 當前 IR */
  ir: FlowIR;
  /** 節點 ID → FlowNode 映射 */
  nodeMap: Map<NodeId, FlowNode>;
  /** 當前節點 ID（用於解析 $input） */
  currentNodeId?: NodeId;
  /** Symbol Table：啟用後表達式會使用命名變數取代 flowState['nodeId'] */
  symbolTable?: SymbolTable;
}

interface ParsedToken {
  type: "literal" | "reference";
  value: string;
}

interface ParsedReference {
  /** 基底引用：nodeId, "$input", "$trigger" */
  base: string;
  /** 子路徑（含 . 前綴），例如 ".data.items[0].name" */
  path: string;
}

// ============================================================
// Main API
// ============================================================

/**
 * 解析表達式字串中所有 {{...}} 引用，替換為對應的 flowState 存取。
 *
 * @param expr - 原始表達式（可含 {{...}} 模板語法）
 * @param context - 編譯器上下文
 * @returns 解析後的 TypeScript 表達式
 */
export function parseExpression(
  expr: string,
  context: ExpressionContext
): string {
  const tokens = tokenize(expr);
  return tokens
    .map((token) => {
      if (token.type === "literal") return token.value;
      return resolveReference(parseReference(token.value), context);
    })
    .join("");
}

// ============================================================
// Tokenizer
// ============================================================

/**
 * 將含 {{...}} 的字串切割為 literal 和 reference tokens。
 * 正確處理：
 *   - 嵌套中括號 {{a.b[c[0]]}}
 *   - 逃脫序列 \\{{ → 字面 {{
 *   - 未關閉的 {{ → 報錯
 */
function tokenize(input: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  let i = 0;
  let literalBuf = "";

  while (i < input.length) {
    // 逃脫序列 \{{ → 字面 {{
    if (input[i] === "\\" && input[i + 1] === "{" && input[i + 2] === "{") {
      literalBuf += "{{";
      i += 3;
      continue;
    }

    // 偵測 {{ 開頭
    if (input[i] === "{" && input[i + 1] === "{") {
      // flush literal
      if (literalBuf) {
        tokens.push({ type: "literal", value: literalBuf });
        literalBuf = "";
      }

      i += 2; // skip {{
      const refStart = i;
      let bracketDepth = 0;

      // 查找對應的 }}，同時追蹤中括號深度
      while (i < input.length) {
        if (input[i] === "[") {
          bracketDepth++;
          i++;
        } else if (input[i] === "]") {
          bracketDepth--;
          i++;
        } else if (
          input[i] === "}" &&
          input[i + 1] === "}" &&
          bracketDepth === 0
        ) {
          break;
        } else {
          i++;
        }
      }

      if (i >= input.length) {
        throw new ExpressionParseError(
          `未關閉的模板表達式：找不到對應的 '}}' (位置 ${refStart - 2})`,
          input,
          refStart - 2
        );
      }

      const refContent = input.slice(refStart, i).trim();
      if (!refContent) {
        throw new ExpressionParseError(
          "空的模板表達式 {{}}",
          input,
          refStart - 2
        );
      }

      tokens.push({ type: "reference", value: refContent });
      i += 2; // skip }}
      continue;
    }

    literalBuf += input[i];
    i++;
  }

  if (literalBuf) {
    tokens.push({ type: "literal", value: literalBuf });
  }

  return tokens;
}

// ============================================================
// Reference Parser
// ============================================================

/**
 * 解析引用字串為 base + path。
 * 例如：
 *   "$input.data.items[0]" → { base: "$input", path: ".data.items[0]" }
 *   "nodeId"               → { base: "nodeId", path: "" }
 *   "$trigger.body.name"   → { base: "$trigger", path: ".body.name" }
 */
function parseReference(ref: string): ParsedReference {
  // 允許開頭有 $ 前綴（特殊變數）
  const match = ref.match(/^(\$?\w+)((?:\.[\w]+|\[.+?\])*)$/);
  if (!match) {
    // 更寬鬆的匹配：支援複雜路徑
    const dotIndex = ref.indexOf(".");
    const bracketIndex = ref.indexOf("[");
    let splitAt = -1;

    if (dotIndex !== -1 && bracketIndex !== -1) {
      splitAt = Math.min(dotIndex, bracketIndex);
    } else if (dotIndex !== -1) {
      splitAt = dotIndex;
    } else if (bracketIndex !== -1) {
      splitAt = bracketIndex;
    }

    if (splitAt > 0) {
      return {
        base: ref.slice(0, splitAt),
        path: ref.slice(splitAt),
      };
    }

    return { base: ref, path: "" };
  }

  return {
    base: match[1],
    path: match[2] || "",
  };
}

// ============================================================
// Reference Resolver
// ============================================================

/**
 * 將 ParsedReference 解析為 TypeScript 表達式。
 */
function resolveReference(
  ref: ParsedReference,
  context: ExpressionContext
): string {
  const { base, path } = ref;

  // ── 特殊變數 $input：解析上一個連入的非觸發器節點 ──
  if (base === "$input") {
    return resolveInputRef(path, context);
  }

  // ── 特殊變數 $trigger：解析觸發器節點 ──
  if (base === "$trigger") {
    return resolveTriggerRef(path, context);
  }

  // ── 一般參照：若有 Symbol Table 則使用命名變數，否則 fallback flowState ──
  if (context.symbolTable?.hasVar(base)) {
    return `${context.symbolTable.getVarName(base)}${path}`;
  }
  return `flowState['${base}']${path}`;
}

function resolveInputRef(
  path: string,
  context: ExpressionContext
): string {
  if (!context.currentNodeId) {
    return `{ error: "No current node context for $input" }`;
  }

  const incoming = context.ir.edges.filter(
    (e) => e.targetNodeId === context.currentNodeId
  );

  // 優先選非觸發器的上游節點
  const dataSource =
    incoming.find((e) => {
      const src = context.nodeMap.get(e.sourceNodeId);
      return src && src.category !== NodeCategory.TRIGGER;
    }) || incoming[0];

  if (dataSource) {
    if (context.symbolTable?.hasVar(dataSource.sourceNodeId)) {
      return `${context.symbolTable.getVarName(dataSource.sourceNodeId)}${path}`;
    }
    return `flowState['${dataSource.sourceNodeId}']${path}`;
  }

  return '{ error: "No input connected" }';
}

function resolveTriggerRef(
  path: string,
  context: ExpressionContext
): string {
  const trigger = context.ir.nodes.find(
    (n) => n.category === NodeCategory.TRIGGER
  );
  if (trigger) {
    if (context.symbolTable?.hasVar(trigger.id)) {
      return `${context.symbolTable.getVarName(trigger.id)}${path}`;
    }
    return `flowState['${trigger.id}']${path}`;
  }
  return "undefined";
}

// ============================================================
// Error Class
// ============================================================

export class ExpressionParseError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly position: number
  ) {
    super(message);
    this.name = "ExpressionParseError";
  }
}
