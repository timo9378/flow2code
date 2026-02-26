/**
 * 拓撲排序與並發偵測演算法
 * 
 * 功能：
 * 1. 計算節點的執行優先順序（拓撲排序）
 * 2. 偵測可並發執行的節點組（用於生成 Promise.all）
 * 3. 建構執行計畫（Execution Plan）
 */

import type {
  FlowIR,
  FlowNode,
  FlowEdge,
  NodeId,
} from "./types";

// ============================================================
// 執行計畫型別
// ============================================================

/** 單一執行步驟 */
export interface ExecutionStep {
  /** 步驟索引 */
  index: number;
  /** 
   * 此步驟中需要執行的節點 ID 列表。
   * 如果長度 > 1，表示可以用 Promise.all 並發執行。
   */
  nodeIds: NodeId[];
  /** 是否可以並發執行 */
  concurrent: boolean;
}

/** 完整執行計畫 */
export interface ExecutionPlan {
  /** 所有步驟（已按拓撲排序） */
  steps: ExecutionStep[];
  /** 拓撲排序結果（扁平） */
  sortedNodeIds: NodeId[];
  /** 每個節點的入邊節點（依賴來源） */
  dependencies: Map<NodeId, Set<NodeId>>;
  /** 每個節點的出邊節點（依賴目標） */
  dependents: Map<NodeId, Set<NodeId>>;
}

// ============================================================
// 圖結構輔助
// ============================================================

interface GraphInfo {
  /** 入度 (indegree) */
  indegree: Map<NodeId, number>;
  /** 鄰接表 (adjacency list) */
  adjacency: Map<NodeId, Set<NodeId>>;
  /** 反向鄰接表 */
  reverseAdjacency: Map<NodeId, Set<NodeId>>;
}

/**
 * 從 IR 建構圖結構
 */
function buildGraph(nodes: FlowNode[], edges: FlowEdge[]): GraphInfo {
  const indegree = new Map<NodeId, number>();
  const adjacency = new Map<NodeId, Set<NodeId>>();
  const reverseAdjacency = new Map<NodeId, Set<NodeId>>();

  // 初始化所有節點
  for (const node of nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, new Set());
    reverseAdjacency.set(node.id, new Set());
  }

  // 建立鄰接關係
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)!.add(edge.targetNodeId);
    reverseAdjacency.get(edge.targetNodeId)!.add(edge.sourceNodeId);
    indegree.set(
      edge.targetNodeId,
      (indegree.get(edge.targetNodeId) ?? 0) + 1
    );
  }

  return { indegree, adjacency, reverseAdjacency };
}

// ============================================================
// Kahn's Algorithm 拓撲排序 + 層級分組
// ============================================================

/**
 * 使用 Kahn 演算法進行拓撲排序，
 * 同時將同一層級（入度同時歸零）的節點分為一組，
 * 以便偵測可並發執行的節點。
 */
export function topologicalSort(ir: FlowIR): ExecutionPlan {
  const { nodes, edges } = ir;
  const { indegree, adjacency, reverseAdjacency } = buildGraph(nodes, edges);

  // 工作副本
  const indegreeCopy = new Map(indegree);
  const sortedNodeIds: NodeId[] = [];
  const steps: ExecutionStep[] = [];

  // 初始入度為 0 的節點（通常是 Trigger）
  let currentLevel: NodeId[] = [];
  for (const [nodeId, degree] of indegreeCopy) {
    if (degree === 0) {
      currentLevel.push(nodeId);
    }
  }

  let stepIndex = 0;

  while (currentLevel.length > 0) {
    // 記錄當前層級
    steps.push({
      index: stepIndex,
      nodeIds: [...currentLevel],
      concurrent: currentLevel.length > 1,
    });
    sortedNodeIds.push(...currentLevel);

    // 計算下一層級
    const nextLevel: NodeId[] = [];
    for (const nodeId of currentLevel) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (indegreeCopy.get(neighbor) ?? 1) - 1;
        indegreeCopy.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextLevel.push(neighbor);
        }
      }
    }

    currentLevel = nextLevel;
    stepIndex++;
  }

  // 建構依賴關係表
  const dependencies = new Map<NodeId, Set<NodeId>>();
  const dependents = new Map<NodeId, Set<NodeId>>();
  for (const node of nodes) {
    dependencies.set(node.id, reverseAdjacency.get(node.id) ?? new Set());
    dependents.set(node.id, adjacency.get(node.id) ?? new Set());
  }

  // 檢查是否有未處理的節點（表示有環）
  if (sortedNodeIds.length !== nodes.length) {
    throw new Error(
      `拓撲排序失敗：圖中存在環路。已排序 ${sortedNodeIds.length}/${nodes.length} 個節點。`
    );
  }

  return {
    steps,
    sortedNodeIds,
    dependencies,
    dependents,
  };
}

// ============================================================
// 工具函式
// ============================================================

/**
 * 取得指定節點的所有依賴節點 ID
 */
export function getDependencies(plan: ExecutionPlan, nodeId: NodeId): NodeId[] {
  return Array.from(plan.dependencies.get(nodeId) ?? []);
}

/**
 * 取得指定節點的所有下游節點 ID
 */
export function getDependents(plan: ExecutionPlan, nodeId: NodeId): NodeId[] {
  return Array.from(plan.dependents.get(nodeId) ?? []);
}

/**
 * 檢查兩個節點是否可以並發執行
 * （即它們之間沒有直接或間接的依賴關係）
 */
export function canRunConcurrently(
  plan: ExecutionPlan,
  nodeA: NodeId,
  nodeB: NodeId
): boolean {
  // 檢查 A 是否在 B 的任何步驟之前或之後
  const stepA = plan.steps.find((s) => s.nodeIds.includes(nodeA));
  const stepB = plan.steps.find((s) => s.nodeIds.includes(nodeB));

  if (!stepA || !stepB) return false;

  // 同一層級即可並發
  return stepA.index === stepB.index;
}

/**
 * 將執行計畫轉為可讀的文字格式（用於除錯）
 */
export function formatExecutionPlan(
  plan: ExecutionPlan,
  nodeMap: Map<NodeId, FlowNode>
): string {
  const lines: string[] = ["=== Execution Plan ==="];

  for (const step of plan.steps) {
    const labels = step.nodeIds
      .map((id) => {
        const node = nodeMap.get(id);
        return node ? `${node.label} (${id})` : id;
      })
      .join(", ");

    const mode = step.concurrent ? "⚡ CONCURRENT" : "→ SEQUENTIAL";
    lines.push(`Step ${step.index} [${mode}]: ${labels}`);
  }

  return lines.join("\n");
}
