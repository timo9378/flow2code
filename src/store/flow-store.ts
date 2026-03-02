/**
 * Flow2Code Canvas State Management (Zustand Store)
 * 
 * Manages:
 * 1. React Flow nodes and edges state
 * 2. Selected node (for side config panel)
 * 3. IR JSON export
 * 
 * Node defaults extracted to @/lib/node-defaults
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
// React Flow Node Data Type
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
// Snapshot Type (for Undo/Redo)
// ============================================================

interface FlowSnapshot {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

// ============================================================
// Store State Interface
// ============================================================

interface FlowStoreState extends UndoRedoSlice<FlowSnapshot> {
  // React Flow state
  nodes: Node<FlowNodeData>[];
  edges: Edge[];

  // Selection state
  selectedNodeId: string | null;

  /** Flow creation time */
  flowCreatedAt: string | null;

  // Node operations
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Flow2Code operations
  addFlowNode: (
    nodeType: NodeType,
    category: NodeCategory,
    position: { x: number; y: number }
  ) => string;
  updateNodeParams: (nodeId: string, params: Partial<NodeParamsMap[NodeType]>) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  selectNode: (nodeId: string | null) => void;
  removeNode: (nodeId: string) => void;

  /** Take snapshot and push to undo stack (zero-arg convenience version) */
  snapshot: () => void;
  /** Undo (zero-arg convenience version, auto-captures current snapshot) */
  undoFlow: () => void;
  /** Redo (zero-arg convenience version, auto-captures current snapshot) */
  redoFlow: () => void;

  // IR export
  exportIR: () => FlowIR;

  // Global operations
  reset: () => void;
  loadIR: (ir: FlowIR) => void;
}

// ============================================================
// Zustand Store
// ============================================================

const MAX_UNDO_HISTORY = 50;

/** Module-internal counter — not exposed as global mutable state */
let _nodeCounter = 0;

/** Create a deep-copy snapshot of current nodes/edges */
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

    // ── Zero-arg convenience methods (for UI / keyboard shortcuts) ──
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
        type: "flowNode", // Uses the unified custom node renderer
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
