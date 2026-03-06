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
  type FlowDataType,
  NodeCategory,
  CURRENT_IR_VERSION,
} from "./types";
import { needsMigration, migrateIR, MigrationError } from "./migrations/index";

export interface ValidationError {
  code: string;
  message: string;
  nodeId?: NodeId;
  edgeId?: string;
  /** Severity level (default: "error") */
  severity?: "error" | "warning" | "info";
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

  // Rebuild nodeMap from workingIR (which may have been migrated)
  const workingNodeMap = new Map<NodeId, FlowNode>(workingIR.nodes.map((n) => [n.id, n]));

  // 2. Must have exactly one Trigger
  const triggers = workingIR.nodes.filter(
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
  for (const node of workingIR.nodes) {
    if (idSet.has(node.id)) {
      errors.push({
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node ID: ${node.id}`,
        nodeId: node.id,
      });
    }
    idSet.add(node.id);
  }

  // 4. Check edge ID uniqueness
  const edgeIdSet = new Set<string>();
  for (const edge of workingIR.edges) {
    if (edgeIdSet.has(edge.id)) {
      errors.push({
        code: "DUPLICATE_EDGE_ID",
        message: `Duplicate edge ID: ${edge.id}`,
        edgeId: edge.id,
      });
    }
    edgeIdSet.add(edge.id);
  }

  // 5. Validate all edge endpoints
  for (const edge of workingIR.edges) {
    if (!workingNodeMap.has(edge.sourceNodeId)) {
      errors.push({
        code: "INVALID_EDGE_SOURCE",
        message: `Edge "${edge.id}" references non-existent source node "${edge.sourceNodeId}"`,
        edgeId: edge.id,
      });
    }
    if (!workingNodeMap.has(edge.targetNodeId)) {
      errors.push({
        code: "INVALID_EDGE_TARGET",
        message: `Edge "${edge.id}" references non-existent target node "${edge.targetNodeId}"`,
        edgeId: edge.id,
      });
    }
  }

  // 5. Cycle detection (DFS)
  const cycleErrors = detectCycles(workingIR.nodes, workingIR.edges);
  errors.push(...cycleErrors);

  // 6. Check for orphan nodes (no edges, not a Trigger)
  const connectedNodes = new Set<NodeId>();
  for (const edge of workingIR.edges) {
    connectedNodes.add(edge.sourceNodeId);
    connectedNodes.add(edge.targetNodeId);
  }
  for (const node of workingIR.nodes) {
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

  // 7. Type compatibility checking on edges
  for (const edge of workingIR.edges) {
    const sourceNode = workingNodeMap.get(edge.sourceNodeId);
    const targetNode = workingNodeMap.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) continue;

    const sourcePort = sourceNode.outputs?.find((p) => p.id === edge.sourcePortId);
    const targetPort = targetNode.inputs?.find((p) => p.id === edge.targetPortId);
    if (!sourcePort || !targetPort) continue;

    if (!isTypeCompatible(sourcePort.dataType, targetPort.dataType)) {
      errors.push({
        code: "TYPE_MISMATCH",
        message: `Type mismatch on edge "${edge.id}": output "${sourcePort.label}" (${sourcePort.dataType}) → input "${targetPort.label}" (${targetPort.dataType})`,
        edgeId: edge.id,
        severity: "warning",
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity !== "warning" && e.severity !== "info").length === 0,
    errors,
    migrated,
    migratedIR: migrated ? workingIR : undefined,
    migrationLog,
  };
}

/**
 * Check if a source data type is compatible with a target data type.
 * "any" is compatible with everything, "object" accepts "array", etc.
 */
function isTypeCompatible(source: FlowDataType, target: FlowDataType): boolean {
  if (source === target) return true;
  if (source === "any" || target === "any") return true;
  // object accepts array (arrays are objects in JS)
  if (target === "object" && source === "array") return true;
  // number/string are loosely compatible in JS expressions
  if (target === "string" && source === "number") return true;
  if (target === "number" && source === "string") return true;
  return false;
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

  // Iterative DFS using explicit stack to avoid stack overflow on deep graphs
  for (const node of nodes) {
    if (color.get(node.id) !== WHITE) continue;

    // Stack stores [nodeId, neighborIndex] pairs
    const stack: [NodeId, number][] = [[node.id, 0]];
    color.set(node.id, GRAY);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [currentId, idx] = top;
      const neighbors = adjacency.get(currentId) ?? [];

      if (idx >= neighbors.length) {
        // All neighbors processed — mark completed
        color.set(currentId, BLACK);
        stack.pop();
        continue;
      }

      // Advance neighbor index
      top[1] = idx + 1;
      const neighbor = neighbors[idx];

      if (color.get(neighbor) === GRAY) {
        errors.push({
          code: "CYCLE_DETECTED",
          message: `Cycle detected: node "${currentId}" → "${neighbor}"`,
          nodeId: currentId,
        });
      } else if (color.get(neighbor) === WHITE) {
        color.set(neighbor, GRAY);
        stack.push([neighbor, 0]);
      }
    }
  }

  return errors;
}
