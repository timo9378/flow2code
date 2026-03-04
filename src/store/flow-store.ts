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
// History Entry (for labeled history timeline)
// ============================================================

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: string;
  nodeCount: number;
  edgeCount: number;
  snapshot: FlowSnapshot;
}

const MAX_HISTORY_ENTRIES = 30;

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

  // ── History (labeled snapshots) ──
  flowHistory: HistoryEntry[];
  pushHistory: (label: string) => void;
  restoreFromHistory: (id: string) => void;
  clearFlowHistory: () => void;

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
  /** Remove all currently selected nodes (for batch delete) */
  removeSelectedNodes: () => void;
  /** Remove all currently selected edges */
  removeSelectedEdges: () => void;
  /** Get IDs of all selected nodes */
  getSelectedNodeIds: () => string[];

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
    flowHistory: [],

    // ── History (labeled snapshots for timeline) ──
    pushHistory: (label: string) => {
      const { nodes, edges, flowHistory } = get();
      if (nodes.length === 0 && edges.length === 0) return;
      const entry: HistoryEntry = {
        id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label,
        timestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        snapshot: createSnapshot(nodes, edges),
      };
      const newHistory = [...flowHistory, entry];
      if (newHistory.length > MAX_HISTORY_ENTRIES) newHistory.shift();
      set({ flowHistory: newHistory });
    },

    restoreFromHistory: (id: string) => {
      const entry = get().flowHistory.find((h) => h.id === id);
      if (!entry) return;
      // Save current state before restoring
      const { nodes, edges } = get();
      if (nodes.length > 0) {
        get().pushHistory("Before restore");
      }
      get().pushSnapshot(createSnapshot(nodes, edges));
      set({
        nodes: entry.snapshot.nodes.map((n) => ({ ...n, data: { ...n.data } })),
        edges: entry.snapshot.edges.map((e) => ({ ...e })),
      });
    },

    clearFlowHistory: () => {
      set({ flowHistory: [] });
    },

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
      // Snapshot before removing nodes so Ctrl+Z can restore them
      const hasRemoval = changes.some((c) => c.type === "remove");
      if (hasRemoval) {
        get().pushSnapshot(createSnapshot(get().nodes, get().edges));
      }
      set({ nodes: applyNodeChanges(changes, get().nodes) as Node<FlowNodeData>[] });
    },

    onEdgesChange: (changes) => {
      // Snapshot before removing edges so Ctrl+Z can restore them
      const hasRemoval = changes.some((c) => c.type === "remove");
      if (hasRemoval) {
        get().pushSnapshot(createSnapshot(get().nodes, get().edges));
      }
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

    removeSelectedNodes: () => {
      const selectedNodeIds = get().nodes.filter((n) => n.selected).map((n) => n.id);
      const selectedEdgeIds = get().edges.filter((e) => e.selected).map((e) => e.id);
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      get().snapshot();
      const nodeIdSet = new Set(selectedNodeIds);
      const edgeIdSet = new Set(selectedEdgeIds);
      set({
        nodes: get().nodes.filter((n) => !nodeIdSet.has(n.id)),
        edges: get().edges.filter(
          (e) => !nodeIdSet.has(e.source) && !nodeIdSet.has(e.target) && !edgeIdSet.has(e.id)
        ),
        selectedNodeId: nodeIdSet.has(get().selectedNodeId ?? "") ? null : get().selectedNodeId,
      });
    },

    removeSelectedEdges: () => {
      const selected = get().edges.filter((e) => e.selected);
      if (selected.length === 0) return;
      get().snapshot();
      const idSet = new Set(selected.map((e) => e.id));
      set({ edges: get().edges.filter((e) => !idSet.has(e.id)) });
    },

    getSelectedNodeIds: () => {
      return get().nodes.filter((n) => n.selected).map((n) => n.id);
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
      // Save current state to history before clearing
      if (get().nodes.length > 0) {
        get().pushHistory("Before reset");
      }
      _nodeCounter = 0;
      get().clearHistory();
      set({ nodes: [], edges: [], selectedNodeId: null, flowCreatedAt: null });
    },

    loadIR: (ir: FlowIR) => {
      // ── Always save current state to undo stack (enables Ctrl+Z even from empty canvas) ──
      const currentNodes = get().nodes;
      const currentEdges = get().edges;
      const metaName = (ir.meta as { name?: string } | undefined)?.name ?? "Untitled";
      if (currentNodes.length > 0) {
        get().pushHistory(`Before loading "${metaName}"`);
      }
      get().pushSnapshot(createSnapshot(currentNodes, currentEdges));

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
        type: "smoothstep",
      }));

      set({ nodes, edges, selectedNodeId: null, flowCreatedAt: ir.meta?.createdAt ?? new Date().toISOString() });
    },
  };
});
