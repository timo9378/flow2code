/**
 * Flow2Code Expression Parser
 *
 * Replaces fragile Regex parsing with a Recursive Descent Parser for template expressions.
 *
 * Supported syntax:
 *   {{nodeId}}                → flowState['nodeId']
 *   {{nodeId.path.to.value}}  → flowState['nodeId'].path.to.value
 *   {{nodeId.arr[0].name}}    → flowState['nodeId'].arr[0].name
 *   {{$input}}                → auto-resolves upstream non-trigger node
 *   {{$input.data.items}}     → same, with sub-path
 *   {{$trigger}}              → trigger node's flowState
 *   {{$trigger.body.userId}}  → flowState['triggerId'].body.userId
 *
 * Differences from Regex version:
 *   - Correctly handles nested brackets e.g. {{node.arr[items[0]]}}
 *   - Correctly handles whitespace e.g. {{ $input.data }}
 *   - Clear error messages, no silent fallthrough
 *   - Supports escape sequences \\{{ to output literal {{
 */

import type { FlowIR, FlowNode, NodeId } from "../ir/types";
import { NodeCategory } from "../ir/types";
import type { SymbolTable } from "./symbol-table";

// ============================================================
// Parser Types
// ============================================================

/**
 * Scope Entry: describes the current scope during code generation.
 * For example, inside a for-loop, the loop node's ID should resolve
 * to _loopScope instead of flowState.
 */
export interface ScopeEntry {
  /** Node ID mapped by this scope */
  nodeId: NodeId;
  /** Variable name in generated code (e.g. _loopScope) */
  scopeVar: string;
}

export interface ExpressionContext {
  /** Current IR */
  ir: FlowIR;
  /** Node ID → FlowNode mapping */
  nodeMap: Map<NodeId, FlowNode>;
  /** Current node ID (used for resolving $input) */
  currentNodeId?: NodeId;
  /** Symbol Table: when enabled, expressions use named variables instead of flowState['nodeId'] */
  symbolTable?: SymbolTable;
  /**
   * Scope Stack: outermost to innermost scope entries.
   * When a reference's base matches a scope's nodeId,
   * it resolves to scopeVar['nodeId'] instead of flowState['nodeId'].
   */
  scopeStack?: ScopeEntry[];
  /**
   * Block-scoped node IDs: these nodes are generated inside sub-blocks
   * (if/else, try/catch, for-loop body), and their Symbol Table aliases
   * are not visible in the outer scope.
   * Expression parsing must fallback to flowState['nodeId'].
   */
  blockScopedNodeIds?: Set<NodeId>;
}

interface ParsedToken {
  type: "literal" | "reference";
  value: string;
}

interface ParsedReference {
  /** Base reference: nodeId, "$input", or "$trigger" */
  base: string;
  /** Sub-path (with . prefix), e.g. ".data.items[0].name" */
  path: string;
}

// ============================================================
// Main API
// ============================================================

/**
 * Parses all {{...}} references in an expression string and replaces them
 * with the corresponding flowState access expressions.
 *
 * @param expr - Raw expression (may contain {{...}} template syntax)
 * @param context - Compiler context
 * @returns Parsed TypeScript expression
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
 * Splits a string containing {{...}} into literal and reference tokens.
 * Correctly handles:
 *   - Nested brackets {{a.b[c[0]]}}
 *   - Escape sequences \\{{ → literal {{
 *   - Unclosed {{ → error
 */
function tokenize(input: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  let i = 0;
  let literalBuf = "";

  while (i < input.length) {
    // Escape sequence \{{ → literal {{
    if (input[i] === "\\" && input[i + 1] === "{" && input[i + 2] === "{") {
      literalBuf += "{{";
      i += 3;
      continue;
    }

    // Detect {{ opening
    if (input[i] === "{" && input[i + 1] === "{") {
      // flush literal
      if (literalBuf) {
        tokens.push({ type: "literal", value: literalBuf });
        literalBuf = "";
      }

      i += 2; // skip {{
      const refStart = i;
      let bracketDepth = 0;

      // Find matching }}, tracking bracket depth
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
          `Unclosed template expression: missing matching '}}' (at position ${refStart - 2})`,
          input,
          refStart - 2
        );
      }

      const refContent = input.slice(refStart, i).trim();
      if (!refContent) {
        throw new ExpressionParseError(
          "Empty template expression {{}}",
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
 * Parses a reference string into base + path.
 * Examples:
 *   "$input.data.items[0]" → { base: "$input", path: ".data.items[0]" }
 *   "nodeId"               → { base: "nodeId", path: "" }
 *   "$trigger.body.name"   → { base: "$trigger", path: ".body.name" }
 */
function parseReference(ref: string): ParsedReference {
  // Allow leading $ prefix (special variables), hyphens in node IDs
  const match = ref.match(/^(\$?[\w-]+)((?:\.[\w]+|\[.+?\])*)$/);
  if (!match) {
    // More lenient matching: support complex paths
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
 * Resolves a ParsedReference into a TypeScript expression.
 */
function resolveReference(
  ref: ParsedReference,
  context: ExpressionContext
): string {
  const { base, path } = ref;

  // ── Special variable $input: resolves upstream non-trigger node ──
  if (base === "$input") {
    return resolveInputRef(path, context);
  }

  // ── Special variable $trigger: resolves trigger node ──
  if (base === "$trigger") {
    return resolveTriggerRef(path, context);
  }

  // ── Check Scope Stack: if base matches a local scope, use that scope first ──
  if (context.scopeStack) {
    // Search from innermost to outermost (array end = innermost)
    for (let i = context.scopeStack.length - 1; i >= 0; i--) {
      const scope = context.scopeStack[i];
      if (scope.nodeId === base) {
        return `${scope.scopeVar}['${base}']${path}`;
      }
    }
  }

  // ── Block-scoped nodes: force fallback to flowState (Symbol Table alias not in scope) ──
  if (context.blockScopedNodeIds?.has(base)) {
    return `flowState['${base}']${path}`;
  }

  // ── Normal reference: use named variable from Symbol Table if available, otherwise fallback to flowState ──
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
    throw new Error(
      `Expression parser error: No current node context for $input reference`
    );
  }

  const incoming = context.ir.edges.filter(
    (e) => e.targetNodeId === context.currentNodeId
  );

  // Prefer non-trigger upstream node
  const nonTriggerIncoming = incoming.filter((e) => {
    const src = context.nodeMap.get(e.sourceNodeId);
    return src && src.category !== NodeCategory.TRIGGER;
  });

  if (nonTriggerIncoming.length > 1 && typeof console !== "undefined") {
    console.warn(
      `[flow2code] $input is ambiguous: node "${context.currentNodeId}" has ${nonTriggerIncoming.length} non-trigger upstream edges. Using first match "${nonTriggerIncoming[0].sourceNodeId}".`
    );
  }

  const dataSource = nonTriggerIncoming[0] || incoming[0];

  if (dataSource) {
    const srcId = dataSource.sourceNodeId;
    // Block-scoped nodes must fallback to flowState
    if (context.blockScopedNodeIds?.has(srcId)) {
      return `flowState['${srcId}']${path}`;
    }
    if (context.symbolTable?.hasVar(srcId)) {
      return `${context.symbolTable.getVarName(srcId)}${path}`;
    }
    return `flowState['${srcId}']${path}`;
  }

  throw new Error(
    `Expression parser error: Node "${context.currentNodeId}" has no input connected`
  );
}

// Cached trigger node ID per IR (avoids linear scan on every call)
let _cachedTriggerIR: FlowIR | null = null;
let _cachedTriggerId: NodeId | null = null;

function resolveTriggerRef(
  path: string,
  context: ExpressionContext
): string {
  // Invalidate cache if IR reference changed
  if (_cachedTriggerIR !== context.ir) {
    _cachedTriggerIR = context.ir;
    const trigger = context.ir.nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    );
    _cachedTriggerId = trigger?.id ?? null;
  }

  if (_cachedTriggerId) {
    if (context.symbolTable?.hasVar(_cachedTriggerId)) {
      return `${context.symbolTable.getVarName(_cachedTriggerId)}${path}`;
    }
    return `flowState['${_cachedTriggerId}']${path}`;
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
