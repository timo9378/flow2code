/**
 * Flow2Code 畫布狀態管理 (Zustand Store)
 * 
 * 管理：
 * 1. React Flow 節點與連線狀態
 * 2. 選取的節點（用於側邊配置面板）
 * 3. IR JSON 匯出
 * 
 * 節點預設值已提取至 @/lib/node-defaults
 */

import { create } from "zustand";
import {
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import {
  type FlowIR,
  type FlowNode,
  type FlowEdge,
  type NodeType,
  type NodeCategory,
  type NodeParamsMap,
  type InputPort,
  type OutputPort,
} from "@/lib/ir/types";
import {
  getDefaultPorts,
  getDefaultParams,
  getDefaultLabel,
  getCategoryForType,
} from "@/lib/node-defaults";
import {
  createUndoRedoSlice,
  type UndoRedoSlice,
} from "./undo-redo-slice";

// ============================================================
// React Flow 節點 data 型別
// ============================================================

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  category: NodeCategory;
  label: string;
  params: NodeParamsMap[NodeType];
  inputs: InputPort[];
  outputs: OutputPort[];
}

// ============================================================
// Snapshot 型別（Undo/Redo 用）
// ============================================================

interface FlowSnapshot {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

// ============================================================
// Store 狀態介面
// ============================================================

interface FlowStoreState extends UndoRedoSlice<FlowSnapshot> {
  // React Flow 狀態
  nodes: Node<FlowNodeData>[];
  edges: Edge[];

  // 選取狀態
  selectedNodeId: string | null;

  /** 流程的建立時間 */
  flowCreatedAt: string | null;

  // 節點操作
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Flow2Code 操作
  addFlowNode: (
    nodeType: NodeType,
    category: NodeCategory,
    position: { x: number; y: number }
  ) => string;
  updateNodeParams: (nodeId: string, params: Partial<NodeParamsMap[NodeType]>) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  selectNode: (nodeId: string | null) => void;
  removeNode: (nodeId: string) => void;

  /** 拍攝快照並推入 undo 堆疊（零參數便捷版） */
  snapshot: () => void;
  /** 復原（零參數便捷版，自動拍攝當前快照） */
  undoFlow: () => void;
  /** 重做（零參數便捷版，自動拍攝當前快照） */
  redoFlow: () => void;

  // IR 匯出
  exportIR: () => FlowIR;

  // 全域操作
  reset: () => void;
  loadIR: (ir: FlowIR) => void;
}

// ============================================================
// Zustand Store
// ============================================================

const MAX_UNDO_HISTORY = 50;

/** 模組內部 counter — 不暴露為全域可變狀態 */
let _nodeCounter = 0;

/** 建立當前 nodes/edges 的深拷貝快照 */
function createSnapshot(nodes: Node<FlowNodeData>[], edges: Edge[]): FlowSnapshot {
  return {
    nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
    edges: edges.map((e) => ({ ...e })),
  };
}

const undoRedoSlice = createUndoRedoSlice<FlowSnapshot>(MAX_UNDO_HISTORY);

export const useFlowStore = create<FlowStoreState>((...args) => {
  const [set, get] = args;
  const undo = undoRedoSlice(...args);

  return {
    ...undo,
    nodes: [],
    edges: [],
    selectedNodeId: null,
    flowCreatedAt: null,

    // ── 零參數便捷方法（UI / 鍵盤快捷鍵使用） ──
    snapshot: () => {
      get().pushSnapshot(createSnapshot(get().nodes, get().edges));
    },

    undoFlow: () => {
      const prev = get().undo(createSnapshot(get().nodes, get().edges));
      if (prev) set({ nodes: prev.nodes, edges: prev.edges });
    },

    redoFlow: () => {
      const next = get().redo(createSnapshot(get().nodes, get().edges));
      if (next) set({ nodes: next.nodes, edges: next.edges });
    },

    onNodesChange: (changes) => {
      set({ nodes: applyNodeChanges(changes, get().nodes) as Node<FlowNodeData>[] });
    },

    onEdgesChange: (changes) => {
      set({ edges: applyEdgeChanges(changes, get().edges) });
    },

    onConnect: (connection) => {
      get().snapshot();
      set({ edges: addEdge(connection, get().edges) });
    },

    addFlowNode: (nodeType, _category, position) => {
      get().snapshot();
      const id = `node_${++_nodeCounter}_${Date.now()}`;
      const category = getCategoryForType(nodeType);
      const { inputs, outputs } = getDefaultPorts(nodeType);
      const params = getDefaultParams(nodeType);
      const label = getDefaultLabel(nodeType);

      const newNode: Node<FlowNodeData> = {
        id,
        type: "flowNode", // 使用統一的自定義節點渲染
        position,
        data: {
          nodeType,
          category,
          label,
          params,
          inputs,
          outputs,
        },
      };

      set({
        nodes: [...get().nodes, newNode],
        flowCreatedAt: get().flowCreatedAt ?? new Date().toISOString(),
      });
      return id;
    },

    updateNodeParams: (nodeId, params) => {
      set({
        nodes: get().nodes.map((node) =>
          node.id === nodeId
            ? {
              ...node,
              data: {
                ...node.data,
                params: { ...node.data.params, ...(params as any) },
              },
            }
            : node
        ),
      });
    },

    updateNodeLabel: (nodeId, label) => {
      set({
        nodes: get().nodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label } }
            : node
        ),
      });
    },

    selectNode: (nodeId) => {
      set({ selectedNodeId: nodeId });
    },

    removeNode: (nodeId) => {
      get().snapshot();
      set({
        nodes: get().nodes.filter((n) => n.id !== nodeId),
        edges: get().edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        ),
        selectedNodeId:
          get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      });
    },

    exportIR: (): FlowIR => {
      const { nodes, edges } = get();

      const irNodes: FlowNode[] = nodes.map((n) => ({
        id: n.id,
        nodeType: n.data.nodeType,
        category: n.data.category,
        label: n.data.label,
        params: n.data.params,
        inputs: n.data.inputs,
        outputs: n.data.outputs,
      }));

      const irEdges: FlowEdge[] = edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        sourcePortId: e.sourceHandle ?? "output",
        targetNodeId: e.target,
        targetPortId: e.targetHandle ?? "input",
      }));

      return {
        version: "1.0.0",
        meta: {
          name: "Untitled Flow",
          description: "",
          createdAt: get().flowCreatedAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        nodes: irNodes,
        edges: irEdges,
      };
    },

    reset: () => {
      _nodeCounter = 0;
      get().clearHistory();
      set({ nodes: [], edges: [], selectedNodeId: null, flowCreatedAt: null });
    },

    loadIR: (ir: FlowIR) => {
      _nodeCounter = ir.nodes.length;

      const nodes: Node<FlowNodeData>[] = ir.nodes.map((n, i) => {
        const defaults = getDefaultPorts(n.nodeType);
        return {
          id: n.id,
          type: "flowNode",
          position: { x: 100 + (i % 3) * 300, y: 100 + Math.floor(i / 3) * 200 },
          data: {
            nodeType: n.nodeType,
            category: n.category,
            label: n.label ?? getDefaultLabel(n.nodeType),
            params: n.params ?? getDefaultParams(n.nodeType),
            inputs: n.inputs ?? defaults.inputs,
            outputs: n.outputs ?? defaults.outputs,
          },
        };
      });

      const edges: Edge[] = ir.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        sourceHandle: e.sourcePortId,
        target: e.targetNodeId,
        targetHandle: e.targetPortId,
        animated: true,
      }));

      set({ nodes, edges, selectedNodeId: null, flowCreatedAt: ir.meta?.createdAt ?? new Date().toISOString() });
    },
  };
});
