/**
 * Flow IR Validator
 *
 * Validates structural correctness of an IR document before compilation:
 * 1. Must have exactly one Trigger node
 * 2. All Edge source/target must reference existing nodes
 * 3. No orphan nodes (except Trigger)
 * 4. Graph must be a DAG (no cycles)
 */

import {
  type FlowIR,
  type FlowNode,
  type FlowEdge,
  type NodeId,
  NodeCategory,
  CURRENT_IR_VERSION,
} from "./types";
import { needsMigration, migrateIR, MigrationError } from "./migrations/index";

export interface ValidationError {
  code: string;
  message: string;
  nodeId?: NodeId;
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** If the IR was auto-migrated, records the migration path */
  migrated?: boolean;
  migratedIR?: FlowIR;
  migrationLog?: string[];
}

/**
 * Validates the structural correctness of a FlowIR document.
 * Auto-migrates older versions before validation if needed.
 */
export function validateFlowIR(ir: FlowIR): ValidationResult {
  const errors: ValidationError[] = [];

  // ── Guard: reject null/undefined/malformed input ──
  if (!ir || typeof ir !== "object") {
    return {
      valid: false,
      errors: [{ code: "INVALID_INPUT", message: "IR input must be a non-null object" }],
    };
  }

  if (!Array.isArray(ir.nodes)) {
    return {
      valid: false,
      errors: [{ code: "MISSING_NODES", message: "IR is missing required 'nodes' array" }],
    };
  }

  if (!Array.isArray(ir.edges)) {
    return {
      valid: false,
      errors: [{ code: "MISSING_EDGES", message: "IR is missing required 'edges' array" }],
    };
  }

  const nodeMap = new Map<NodeId, FlowNode>(ir.nodes.map((n) => [n.id, n]));

  // 1. Version handling: auto-migrate
  let workingIR = ir;
  let migrated = false;
  let migrationLog: string[] | undefined;

  if (needsMigration(ir.version)) {
    try {
      const result = migrateIR(
        { version: ir.version, meta: ir.meta, nodes: ir.nodes as unknown[], edges: ir.edges as unknown[] },
        CURRENT_IR_VERSION
      );
      if (result.migrated) {
        workingIR = result.ir as unknown as FlowIR;
        migrated = true;
        migrationLog = result.applied;
      }
    } catch (err) {
      if (err instanceof MigrationError) {
        errors.push({
          code: "MIGRATION_FAILED",
          message: `IR version migration failed: ${err.message}`,
        });
      } else {
        errors.push({
          code: "INVALID_VERSION",
          message: `Unsupported IR version: ${ir.version}`,
        });
      }
    }
  }

  // Validate version after migration
  if (!migrated && workingIR.version !== CURRENT_IR_VERSION) {
    errors.push({
      code: "INVALID_VERSION",
      message: `Unsupported IR version: ${workingIR.version} (current: ${CURRENT_IR_VERSION})`,
    });
  }

  // 2. Must have exactly one Trigger
  const triggers = ir.nodes.filter(
    (n) => n.category === NodeCategory.TRIGGER
  );
  if (triggers.length === 0) {
    errors.push({
      code: "NO_TRIGGER",
      message: "Workflow must contain at least one trigger node",
    });
  }
  if (triggers.length > 1) {
    errors.push({
      code: "MULTIPLE_TRIGGERS",
      message: `Workflow must have exactly one trigger, found ${triggers.length}`,
    });
  }

  // 3. Check node ID uniqueness
  const idSet = new Set<string>();
  for (const node of ir.nodes) {
    if (idSet.has(node.id)) {
      errors.push({
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node ID: ${node.id}`,
        nodeId: node.id,
      });
    }
    idSet.add(node.id);
  }

  // 4. Validate all edge endpoints
  for (const edge of ir.edges) {
    if (!nodeMap.has(edge.sourceNodeId)) {
      errors.push({
        code: "INVALID_EDGE_SOURCE",
        message: `Edge "${edge.id}" references non-existent source node "${edge.sourceNodeId}"`,
        edgeId: edge.id,
      });
    }
    if (!nodeMap.has(edge.targetNodeId)) {
      errors.push({
        code: "INVALID_EDGE_TARGET",
        message: `Edge "${edge.id}" references non-existent target node "${edge.targetNodeId}"`,
        edgeId: edge.id,
      });
    }
  }

  // 5. Cycle detection (DFS)
  const cycleErrors = detectCycles(ir.nodes, ir.edges);
  errors.push(...cycleErrors);

  // 6. Check for orphan nodes (no edges, not a Trigger)
  const connectedNodes = new Set<NodeId>();
  for (const edge of ir.edges) {
    connectedNodes.add(edge.sourceNodeId);
    connectedNodes.add(edge.targetNodeId);
  }
  for (const node of ir.nodes) {
    if (
      node.category !== NodeCategory.TRIGGER &&
      !connectedNodes.has(node.id)
    ) {
      errors.push({
        code: "ORPHAN_NODE",
        message: `Node "${node.id}" (${node.label}) is not connected to any other node`,
        nodeId: node.id,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    migrated,
    migratedIR: migrated ? workingIR : undefined,
    migrationLog,
  };
}

/**
 * Detect cycles in a directed graph via DFS coloring.
 */
function detectCycles(
  nodes: FlowNode[],
  edges: FlowEdge[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Build adjacency list
  const adjacency = new Map<NodeId, NodeId[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const WHITE = 0; // Unvisited
  const GRAY = 1;  // In current DFS path
  const BLACK = 2; // Completed

  const color = new Map<NodeId, number>();
  for (const node of nodes) {
    color.set(node.id, WHITE);
  }

  function dfs(nodeId: NodeId): boolean {
    color.set(nodeId, GRAY);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (color.get(neighbor) === GRAY) {
        errors.push({
          code: "CYCLE_DETECTED",
          message: `Cycle detected: node "${nodeId}" → "${neighbor}"`,
          nodeId,
        });
        return true;
      }
      if (color.get(neighbor) === WHITE) {
        if (dfs(neighbor)) return true;
      }
    }

    color.set(nodeId, BLACK);
    return false;
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      dfs(node.id);
    }
  }

  return errors;
}
