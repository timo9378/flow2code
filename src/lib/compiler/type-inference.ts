/**
 * Flow2Code Type Inference Engine
 *
 * Infers TypeScript types for flowState based on FlowIR node definitions and port types.
 * Replaces the crude `Record<string, any>` declaration to provide real type safety in generated code.
 *
 * Inference strategies:
 *   1. Trigger nodes: inferred from trigger type and parameters (e.g. HTTP body, query, etc.)
 *   2. Action nodes: inferred from the plugin's getOutputType()
 *   3. Manual specification: uses the port's dataType as a fallback
 *   4. Auto-narrowing: $input references are narrowed based on upstream node types
 */

import type { FlowIR, FlowNode, NodeType } from "../ir/types";
import { getPlugin } from "./plugins/types";
import type { PluginRegistry } from "./plugins/types";

// ============================================================
// Type Inference API
// ============================================================

export interface FlowStateTypeInfo {
  /** Complete TypeScript interface source code */
  interfaceCode: string;
  /** TypeScript type corresponding to each node ID */
  nodeTypes: Map<string, string>;
}

/**
 * Infer the output types of all nodes in a FlowIR and generate the corresponding TypeScript interface.
 *
 * @param ir - Flow IR
 * @returns FlowStateTypeInfo containing the generated interface and per-node type mappings
 */
export function inferFlowStateTypes(ir: FlowIR, registry?: PluginRegistry): FlowStateTypeInfo {
  const nodeTypes = new Map<string, string>();

  for (const node of ir.nodes) {
    const type = inferNodeOutputType(node, registry);
    nodeTypes.set(node.id, type);
  }

  // Generate interface code (all fields are optional since nodes execute in topological order and not every one will be assigned)
  const fields = ir.nodes
    .map((node) => {
      const type = nodeTypes.get(node.id) || "unknown";
      const safeId = node.id;
      return `  '${safeId}'?: ${type};`;
    })
    .join("\n");

  const interfaceCode = `interface FlowState {\n${fields}\n}`;

  return { interfaceCode, nodeTypes };
}


// ============================================================
// Single Node Type Inference
// ============================================================

function inferNodeOutputType(node: FlowNode, registry?: PluginRegistry): string {
  // 1. Try to get type from Plugin (prefer per-instance registry, fallback to global)
  const plugin = registry?.get(node.nodeType) ?? getPlugin(node.nodeType);
  if (plugin?.getOutputType) {
    return plugin.getOutputType(node);
  }

  // 2. Infer from port's dataType
  if (node.outputs && node.outputs.length > 0) {
    const primaryOutput = node.outputs[0];
    return mapFlowDataTypeToTS(primaryOutput.dataType);
  }

  // 3. Fallback
  return "unknown";
}

/**
 * Map FlowDataType to TypeScript types.
 */
function mapFlowDataTypeToTS(
  dataType: string
): string {
  switch (dataType) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "Record<string, unknown>";
    case "array":
      return "unknown[]";
    case "void":
      return "void";
    case "Response":
      return "Response";
    case "any":
    default:
      return "unknown";
  }
}
