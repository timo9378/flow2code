/**
 * useUpstreamTypes — Real-time inference of upstream node flowState types
 *
 * Solves the "canvas blind typing problem":
 * When editing Custom Code / Expression, developers need to know
 * what fields are in `flowState` & their corresponding TypeScript types.
 *
 * This hook constructs a "partial IR up to the selected node" from the current
 * store's nodes + edges, and calls inferFlowStateTypes to get upstream node output types.
 *
 * @example
 * ```tsx
 * function ConfigPanel() {
 *   const types = useUpstreamTypes("fetch_api_1");
 *   // types.entries = [{ nodeId: "trigger_1", label: "HTTP Webhook", tsType: "Record<string, unknown>" }]
 *   // types.interfaceCode = "interface FlowState { ... }"
 * }
 * ```
 */

"use client";

import { useMemo } from "react";
import { useFlowStore } from "@/store/flow-store";
import { inferFlowStateTypes } from "@/lib/compiler/type-inference";
import type { FlowIR, FlowNode, FlowEdge, NodeType, NodeCategory } from "@/lib/ir/types";
import { CURRENT_IR_VERSION } from "@/lib/ir/types";

// ── Types ──

export interface UpstreamTypeEntry {
  nodeId: string;
  label: string;
  nodeType: string;
  tsType: string;
}

export interface UpstreamTypes {
  /** List of upstream node types (in topological order) */
  entries: UpstreamTypeEntry[];
  /** Full interface FlowState { ... } source code */
  interfaceCode: string;
  /** Whether type information is available */
  hasTypes: boolean;
}

const EMPTY: UpstreamTypes = { entries: [], interfaceCode: "", hasTypes: false };

// ── Hook ──

/**
 * Infer the available flowState types for upstream nodes of the specified node
 *
 * @param selectedNodeId - Currently selected node ID (returns empty result when null)
 */
export function useUpstreamTypes(selectedNodeId: string | null): UpstreamTypes {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);

  return useMemo(() => {
    if (!selectedNodeId) return EMPTY;
    if (nodes.length === 0) return EMPTY;

    // Find all upstream nodes (by traversing edges backwards)
    const upstreamIds = collectUpstream(selectedNodeId, edges);

    // Exclude self (we want flowState that is "usable within this node")
    const upstreamNodes = nodes.filter((n) => upstreamIds.has(n.id));
    if (upstreamNodes.length === 0) return EMPTY;

    // Build partial IR (only upstream nodes + related edges)
    const irNodes: FlowNode[] = upstreamNodes.map((n) => ({
      id: n.id,
      nodeType: n.data.nodeType as NodeType,
      category: n.data.category as NodeCategory,
      label: n.data.label,
      params: n.data.params as FlowNode["params"],
      inputs: n.data.inputs,
      outputs: n.data.outputs,
    }));

    const nodeIdSet = new Set(irNodes.map((n) => n.id));
    const irEdges: FlowEdge[] = edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        sourcePortId: e.sourceHandle ?? "output",
        targetNodeId: e.target,
        targetPortId: e.targetHandle ?? "input",
      }));

    const ir: FlowIR = {
      version: CURRENT_IR_VERSION,
      meta: { name: "_partial", createdAt: "", updatedAt: "" },
      nodes: irNodes,
      edges: irEdges,
    };

    try {
      const { interfaceCode, nodeTypes } = inferFlowStateTypes(ir);

      const entries: UpstreamTypeEntry[] = irNodes.map((n) => ({
        nodeId: n.id,
        label: n.label,
        nodeType: n.nodeType,
        tsType: nodeTypes.get(n.id) ?? "unknown",
      }));

      return {
        entries,
        interfaceCode,
        hasTypes: entries.length > 0,
      };
    } catch {
      return EMPTY;
    }
  }, [selectedNodeId, nodes, edges]);
}

// ── Helpers ──

/** Find all upstream nodes of the specified node (BFS reverse traversal) */
function collectUpstream(
  targetId: string,
  edges: Array<{ source: string; target: string }>
): Set<string> {
  // Build reverse adjacency list
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.target) ?? [];
    list.push(e.source);
    incoming.set(e.target, list);
  }

  const visited = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const parents = incoming.get(current) ?? [];
    for (const parent of parents) {
      if (!visited.has(parent)) {
        visited.add(parent);
        queue.push(parent);
      }
    }
  }

  return visited;
}
