/**
 * Flow2Code 畫布狀態管理 (Zustand Store)
 * 
 * 管理：
 * 1. React Flow 節點與連線狀態
 * 2. 選取的節點（用於側邊配置面板）
 * 3. IR JSON 匯出
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
  NodeCategory as NC,
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
} from "@/lib/ir/types";

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

  // IR 匯出
  exportIR: () => FlowIR;

  // 全域操作
  reset: () => void;
  loadIR: (ir: FlowIR) => void;
}

// ============================================================
// 預設端口定義
// ============================================================

function getDefaultPorts(nodeType: NodeType): {
  inputs: InputPort[];
  outputs: OutputPort[];
} {
  switch (nodeType) {
    // Triggers - 只有輸出
    case TriggerType.HTTP_WEBHOOK:
      return {
        inputs: [],
        outputs: [
          { id: "request", label: "Request", dataType: "object" },
          { id: "body", label: "Body", dataType: "object" },
          { id: "query", label: "Query", dataType: "object" },
        ],
      };
    case TriggerType.CRON_JOB:
    case TriggerType.MANUAL:
      return {
        inputs: [],
        outputs: [{ id: "output", label: "Output", dataType: "any" }],
      };

    // Actions
    case ActionType.FETCH_API:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "response", label: "Response", dataType: "object" },
          { id: "data", label: "Data", dataType: "any" },
        ],
      };
    case ActionType.SQL_QUERY:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "array" }],
      };
    case ActionType.REDIS_CACHE:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "value", label: "Value", dataType: "any" }],
      };
    case ActionType.CUSTOM_CODE:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      };

    // Logic
    case LogicType.IF_ELSE:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      };
    case LogicType.FOR_LOOP:
      return {
        inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
        outputs: [
          { id: "item", label: "Item", dataType: "any" },
          { id: "result", label: "Result", dataType: "array" },
        ],
      };
    case LogicType.TRY_CATCH:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "success", label: "Success", dataType: "any" },
          { id: "error", label: "Error", dataType: "object" },
        ],
      };
    case LogicType.PROMISE_ALL:
      return {
        inputs: [
          { id: "task1", label: "Task 1", dataType: "any", required: true },
          { id: "task2", label: "Task 2", dataType: "any", required: true },
        ],
        outputs: [{ id: "results", label: "Results", dataType: "array" }],
      };

    // Variable
    case VariableType.DECLARE:
      return {
        inputs: [],
        outputs: [{ id: "value", label: "Value", dataType: "any" }],
      };
    case VariableType.TRANSFORM:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [{ id: "output", label: "Output", dataType: "any" }],
      };

    // Output
    case OutputType.RETURN_RESPONSE:
      return {
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      };

    default:
      return { inputs: [], outputs: [] };
  }
}

function getDefaultParams(nodeType: NodeType): NodeParamsMap[NodeType] {
  switch (nodeType) {
    case TriggerType.HTTP_WEBHOOK:
      return { method: "POST", routePath: "/api/endpoint", parseBody: true } as NodeParamsMap[typeof TriggerType.HTTP_WEBHOOK];
    case TriggerType.CRON_JOB:
      return { schedule: "0 * * * *", functionName: "cronHandler" } as NodeParamsMap[typeof TriggerType.CRON_JOB];
    case TriggerType.MANUAL:
      return { functionName: "handler", args: [] } as NodeParamsMap[typeof TriggerType.MANUAL];
    case ActionType.FETCH_API:
      return { url: "https://api.example.com", method: "GET", parseJson: true } as NodeParamsMap[typeof ActionType.FETCH_API];
    case ActionType.SQL_QUERY:
      return { orm: "drizzle", query: "SELECT * FROM users", params: [] } as NodeParamsMap[typeof ActionType.SQL_QUERY];
    case ActionType.REDIS_CACHE:
      return { operation: "get", key: "cache_key" } as NodeParamsMap[typeof ActionType.REDIS_CACHE];
    case ActionType.CUSTOM_CODE:
      return { code: "// your code here", returnVariable: "result" } as NodeParamsMap[typeof ActionType.CUSTOM_CODE];
    case LogicType.IF_ELSE:
      return { condition: "data !== null" } as NodeParamsMap[typeof LogicType.IF_ELSE];
    case LogicType.FOR_LOOP:
      return { iterableExpression: "items", itemVariable: "item" } as NodeParamsMap[typeof LogicType.FOR_LOOP];
    case LogicType.TRY_CATCH:
      return { errorVariable: "error" } as NodeParamsMap[typeof LogicType.TRY_CATCH];
    case LogicType.PROMISE_ALL:
      return {} as NodeParamsMap[typeof LogicType.PROMISE_ALL];
    case VariableType.DECLARE:
      return { name: "myVar", dataType: "string", isConst: true, initialValue: "''" } as NodeParamsMap[typeof VariableType.DECLARE];
    case VariableType.TRANSFORM:
      return { expression: "input.map(x => x)" } as NodeParamsMap[typeof VariableType.TRANSFORM];
    case OutputType.RETURN_RESPONSE:
      return { statusCode: 200, bodyExpression: "{{$input}}" } as NodeParamsMap[typeof OutputType.RETURN_RESPONSE];
    default:
      return {} as NodeParamsMap[NodeType];
  }
}

function getDefaultLabel(nodeType: NodeType): string {
  const labels: Record<string, string> = {
    [TriggerType.HTTP_WEBHOOK]: "HTTP Webhook",
    [TriggerType.CRON_JOB]: "Cron Job",
    [TriggerType.MANUAL]: "Manual Trigger",
    [ActionType.FETCH_API]: "Fetch API",
    [ActionType.SQL_QUERY]: "SQL Query",
    [ActionType.REDIS_CACHE]: "Redis Cache",
    [ActionType.CUSTOM_CODE]: "Custom Code",
    [LogicType.IF_ELSE]: "If / Else",
    [LogicType.FOR_LOOP]: "For Loop",
    [LogicType.TRY_CATCH]: "Try / Catch",
    [LogicType.PROMISE_ALL]: "Promise.all",
    [VariableType.DECLARE]: "Variable",
    [VariableType.TRANSFORM]: "Transform",
    [OutputType.RETURN_RESPONSE]: "Return Response",
  };
  return labels[nodeType] ?? "Unknown";
}

function getCategoryForType(nodeType: NodeType): NodeCategory {
  if (Object.values(TriggerType).includes(nodeType as TriggerType)) return NC.TRIGGER;
  if (Object.values(ActionType).includes(nodeType as ActionType)) return NC.ACTION;
  if (Object.values(LogicType).includes(nodeType as LogicType)) return NC.LOGIC;
  if (Object.values(VariableType).includes(nodeType as VariableType)) return NC.VARIABLE;
  if (Object.values(OutputType).includes(nodeType as OutputType)) return NC.OUTPUT;
  return NC.ACTION;
}

// ============================================================
// Zustand Store
// ============================================================

let nodeCounter = 0;

export const useFlowStore = create<FlowStoreState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as Node<FlowNodeData>[] });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    set({ edges: addEdge(connection, get().edges) });
  },

  addFlowNode: (nodeType, _category, position) => {
    const id = `node_${++nodeCounter}_${Date.now()}`;
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

    set({ nodes: [...get().nodes, newNode] });
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      nodes: irNodes,
      edges: irEdges,
    };
  },

  reset: () => {
    nodeCounter = 0;
    set({ nodes: [], edges: [], selectedNodeId: null });
  },

  loadIR: (ir: FlowIR) => {
    nodeCounter = ir.nodes.length;

    const nodes: Node<FlowNodeData>[] = ir.nodes.map((n, i) => ({
      id: n.id,
      type: "flowNode",
      position: { x: 100 + (i % 3) * 300, y: 100 + Math.floor(i / 3) * 200 },
      data: {
        nodeType: n.nodeType,
        category: n.category,
        label: n.label,
        params: n.params,
        inputs: n.inputs,
        outputs: n.outputs,
      },
    }));

    const edges: Edge[] = ir.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      sourceHandle: e.sourcePortId,
      target: e.targetNodeId,
      targetHandle: e.targetPortId,
      animated: true,
    }));

    set({ nodes, edges, selectedNodeId: null });
  },
}));
