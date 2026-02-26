/**
 * useUpstreamTypes — 即時推斷上游節點的 flowState 型別
 *
 * 解決「畫布盲打問題」：
 * 在編輯 Custom Code / Expression 時，開發者需要知道
 * `flowState` 裡有哪些欄位 & 對應的 TypeScript 型別。
 *
 * 此 hook 從目前 store 的 nodes + edges 建構一個「截至所選節點為止的 partial IR」，
 * 呼叫 inferFlowStateTypes 取得上游節點輸出的型別資訊。
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
  /** 上游節點的型別列表（按拓撲順序） */
  entries: UpstreamTypeEntry[];
  /** 完整的 interface FlowState { ... } 原始碼 */
  interfaceCode: string;
  /** 是否有可用的型別資訊 */
  hasTypes: boolean;
}

const EMPTY: UpstreamTypes = { entries: [], interfaceCode: "", hasTypes: false };

// ── Hook ──

/**
 * 推斷指定節點的上游 flowState 可用型別
 *
 * @param selectedNodeId - 目前選中的節點 ID（為 null 時回傳空結果）
 */
export function useUpstreamTypes(selectedNodeId: string | null): UpstreamTypes {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);

  return useMemo(() => {
    if (!selectedNodeId) return EMPTY;
    if (nodes.length === 0) return EMPTY;

    // 找出所有上游節點（透過 edges 反向走訪）
    const upstreamIds = collectUpstream(selectedNodeId, edges);

    // 也將自身排除（我們要的是「可在這個節點中使用的」flowState）
    const upstreamNodes = nodes.filter((n) => upstreamIds.has(n.id));
    if (upstreamNodes.length === 0) return EMPTY;

    // 建構 partial IR（只包含上游節點 + 相關 edges）
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

/** 找出指定節點的所有上游節點（BFS 反向走訪） */
function collectUpstream(
  targetId: string,
  edges: Array<{ source: string; target: string }>
): Set<string> {
  // 建構反向鄰接表
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
