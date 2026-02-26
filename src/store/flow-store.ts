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
// Store 狀態介面
// ============================================================

interface FlowStoreState {
  // React Flow 狀態
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  
  // 選取狀態
  selectedNodeId: string | null;

  /** 流程的建立時間 */
  flowCreatedAt: string | null;

  // Undo/Redo 歷史
  undoStack: Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }>;
  redoStack: Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }>;

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

  // Undo/Redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;

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

export const useFlowStore = create<FlowStoreState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  flowCreatedAt: null,
  undoStack: [],
  redoStack: [],

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as Node<FlowNodeData>[] });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    get().pushSnapshot();
    set({ edges: addEdge(connection, get().edges) });
  },

  addFlowNode: (nodeType, _category, position) => {
    get().pushSnapshot();
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
                params: { ...node.data.params, ...params },
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
    get().pushSnapshot();
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      ),
      selectedNodeId:
        get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  pushSnapshot: () => {
    const { nodes, edges, undoStack } = get();
    const snapshot = {
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    };
    const newStack = [...undoStack, snapshot];
    if (newStack.length > MAX_UNDO_HISTORY) newStack.shift();
    set({ undoStack: newStack, redoStack: [] });
  },

  undo: () => {
    const { undoStack, nodes, edges } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const currentSnapshot = {
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    };
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, currentSnapshot],
      nodes: prev.nodes,
      edges: prev.edges,
    });
  },

  redo: () => {
    const { redoStack, nodes, edges } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const currentSnapshot = {
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    };
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, currentSnapshot],
      nodes: next.nodes,
      edges: next.edges,
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
    set({ nodes: [], edges: [], selectedNodeId: null, flowCreatedAt: null, undoStack: [], redoStack: [] });
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
}));
