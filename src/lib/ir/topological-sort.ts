/**
 * Topological Sort and Concurrency Detection Algorithm
 * 
 * Features:
 * 1. Compute node execution priority (topological sort)
 * 2. Detect groups of concurrently executable nodes (for generating Promise.all)
 * 3. Build Execution Plan
 */

import type {
  FlowIR,
  FlowNode,
  FlowEdge,
  NodeId,
} from "./types";

// ============================================================
// Execution Plan Types
// ============================================================

/** Single execution step */
export interface ExecutionStep {
  /** Step index */
  index: number;
  /** 
   * List of node IDs to execute in this step.
   * If length > 1, they can be executed concurrently with Promise.all.
   */
  nodeIds: NodeId[];
  /** Whether it can execute concurrently */
  concurrent: boolean;
}

/** Complete execution plan */
export interface ExecutionPlan {
  /** All steps (topologically sorted) */
  steps: ExecutionStep[];
  /** Topological sort result (flat) */
  sortedNodeIds: NodeId[];
  /** Incoming nodes for each node (dependency sources) */
  dependencies: Map<NodeId, Set<NodeId>>;
  /** Outgoing nodes for each node (dependency targets) */
  dependents: Map<NodeId, Set<NodeId>>;
}

// ============================================================
// Graph Structure Helpers
// ============================================================

interface GraphInfo {
  /** Indegree */
  indegree: Map<NodeId, number>;
  /** Adjacency list */
  adjacency: Map<NodeId, Set<NodeId>>;
  /** Reverse adjacency list */
  reverseAdjacency: Map<NodeId, Set<NodeId>>;
}

/**
 * Build graph structure from IR
 */
function buildGraph(nodes: FlowNode[], edges: FlowEdge[]): GraphInfo {
  const indegree = new Map<NodeId, number>();
  const adjacency = new Map<NodeId, Set<NodeId>>();
  const reverseAdjacency = new Map<NodeId, Set<NodeId>>();

  // Initialize all nodes
  for (const node of nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, new Set());
    reverseAdjacency.set(node.id, new Set());
  }

  // Build adjacency relationships
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
// Kahn's Algorithm Topological Sort + Level Grouping
// ============================================================

/**
 * Perform topological sort using Kahn's algorithm,
 * grouping nodes at the same level (indegree reaches zero simultaneously)
 * to detect concurrently executable nodes.
 */
export function topologicalSort(ir: FlowIR): ExecutionPlan {
  const { nodes, edges } = ir;
  const { indegree, adjacency, reverseAdjacency } = buildGraph(nodes, edges);

  // Working copy
  const indegreeCopy = new Map(indegree);
  const sortedNodeIds: NodeId[] = [];
  const steps: ExecutionStep[] = [];

  // Nodes with initial indegree of 0 (typically Triggers)
  let currentLevel: NodeId[] = [];
  for (const [nodeId, degree] of indegreeCopy) {
    if (degree === 0) {
      currentLevel.push(nodeId);
    }
  }

  let stepIndex = 0;

  while (currentLevel.length > 0) {
    // Record current level
    steps.push({
      index: stepIndex,
      nodeIds: [...currentLevel],
      concurrent: currentLevel.length > 1,
    });
    sortedNodeIds.push(...currentLevel);

    // Compute next level
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

  // Build dependency table
  const dependencies = new Map<NodeId, Set<NodeId>>();
  const dependents = new Map<NodeId, Set<NodeId>>();
  for (const node of nodes) {
    dependencies.set(node.id, reverseAdjacency.get(node.id) ?? new Set());
    dependents.set(node.id, adjacency.get(node.id) ?? new Set());
  }

  // Check for unprocessed nodes (indicates a cycle)
  if (sortedNodeIds.length !== nodes.length) {
    throw new Error(
      `Topological sort failed: cycle detected in graph. Sorted ${sortedNodeIds.length}/${nodes.length} nodes.`
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
// Utility Functions
// ============================================================

/**
 * Get all dependency node IDs for a given node
 */
export function getDependencies(plan: ExecutionPlan, nodeId: NodeId): NodeId[] {
  return Array.from(plan.dependencies.get(nodeId) ?? []);
}

/**
 * Get all downstream node IDs for a given node
 */
export function getDependents(plan: ExecutionPlan, nodeId: NodeId): NodeId[] {
  return Array.from(plan.dependents.get(nodeId) ?? []);
}

/**
 * Check if two nodes can execute concurrently
 * (i.e., there is no direct or indirect dependency between them)
 */
export function canRunConcurrently(
  plan: ExecutionPlan,
  nodeA: NodeId,
  nodeB: NodeId
): boolean {
  // Check if A is before or after B in any step
  const stepA = plan.steps.find((s) => s.nodeIds.includes(nodeA));
  const stepB = plan.steps.find((s) => s.nodeIds.includes(nodeB));

  if (!stepA || !stepB) return false;

  // Same level means concurrent execution is possible
  return stepA.index === stepB.index;
}

/**
 * Format the execution plan into readable text (for debugging)
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
