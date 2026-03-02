/**
 * Node Default Values (backward compatibility layer)
 *
 * Now delegated to NodeRegistry — these functions are kept to avoid breaking existing callers.
 * New code should use `nodeRegistry` or `NodeRegistry` class directly.
 *
 * @see {@link ./node-registry.ts}
 */

import { type NodeType, type NodeCategory, type NodeParamsMap, type InputPort, type OutputPort } from "@/lib/ir/types";
import { nodeRegistry } from "@/lib/node-registry";

/**
 * Get default input/output ports for a node type
 */
export function getDefaultPorts(nodeType: NodeType): {
  inputs: InputPort[];
  outputs: OutputPort[];
} {
  return nodeRegistry.getDefaultPorts(nodeType);
}

/**
 * Get default parameters for a node type
 */
export function getDefaultParams(nodeType: NodeType): NodeParamsMap[NodeType] {
  return nodeRegistry.getDefaultParams(nodeType) as NodeParamsMap[NodeType];
}

/**
 * Get default label for a node type
 */
export function getDefaultLabel(nodeType: NodeType): string {
  return nodeRegistry.getDefaultLabel(nodeType);
}

/**
 * Infer category from node type
 */
export function getCategoryForType(nodeType: NodeType): NodeCategory {
  return nodeRegistry.getCategoryForType(nodeType);
}
