/**
 * Flow2Code Symbol Table
 *
 * Maps node IDs to human-readable variable names (derived from node labels).
 * Enables "ejectable" code generation — generated TypeScript looks like hand-written code.
 *
 * Naming strategy:
 *   "GET /api/hello"          → getApiHello
 *   "Fetch Available Models"  → fetchAvailableModels
 *   "Return Hello"            → returnHello
 *   "Check Valid"             → checkValid
 *   "Call External API"       → callExternalApi
 *
 * Conflict resolution: duplicate variable names auto-suffixed with _2, _3 ...
 * Reserved word protection: JS/TS reserved words + common identifiers in generated code auto-suffixed with Result
 */

import type { FlowIR, NodeId } from "../ir/types";

// ============================================================
// Public API
// ============================================================

export interface SymbolTable {
  /** Get the human-readable variable name for a node */
  getVarName(nodeId: NodeId): string;
  /** Check if a node has a named variable */
  hasVar(nodeId: NodeId): boolean;
  /** Get all mappings */
  getAllMappings(): ReadonlyMap<NodeId, string>;
}

/**
 * Build a Symbol Table from all node labels in a FlowIR.
 * Each node ID is mapped to a unique camelCase variable name.
 */
export function buildSymbolTable(ir: FlowIR): SymbolTable {
  const mappings = new Map<NodeId, string>();
  const usedNames = new Set<string>();

  for (const node of ir.nodes) {
    let name = labelToVarName(node.label);

    // Protect reserved words
    if (!name || RESERVED_WORDS.has(name)) {
      name = `${name || "node"}Result`;
    }

    // Ensure starts with a letter or underscore
    if (/^[0-9]/.test(name)) {
      name = `_${name}`;
    }

    // Conflict resolution
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
// Label → camelCase Conversion
// ============================================================

/**
 * Convert a user-visible node label to a camelCase variable name.
 *
 * @example
 * labelToVarName("GET /api/hello")        // "getApiHello"
 * labelToVarName("Fetch Available Models") // "fetchAvailableModels"
 * labelToVarName("Call External API")      // "callExternalApi"
 */
export function labelToVarName(label: string): string {
  const cleaned = label
    .replace(/[/\-_.]/g, " ") // slashes, hyphens, underscores, dots → spaces
    .replace(/[^a-zA-Z0-9\s]/g, "") // remove other special characters
    .trim();

  if (!cleaned) return "";

  const words = cleaned
    .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase boundaries
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
// Reserved Words Set
// ============================================================

const RESERVED_WORDS = new Set([
  // JavaScript reserved words
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "async",
  // Built-in global values
  "undefined", "null", "true", "false", "NaN", "Infinity",
  // Common identifiers in generated code (avoid shadowing)
  "req", "res", "body", "query", "data", "result", "response", "error",
  "flowState", "searchParams", "NextResponse", "NextRequest",
]);
