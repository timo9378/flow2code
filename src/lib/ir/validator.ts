/**
 * Flow IR 驗證器
 * 
 * 在編譯前驗證 IR 文件的結構正確性：
 * 1. 必須有且僅有一個 Trigger 節點
 * 2. 所有 Edge 的 source/target 必須指向存在的節點
 * 3. 不能有孤立節點（除 Trigger 外）
 * 4. 圖必須是 DAG（無環）
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
  /** 若 IR 經過版本遷移，記錄遷移路徑 */
  migrated?: boolean;
  migratedIR?: FlowIR;
  migrationLog?: string[];
}

/**
 * 驗證 FlowIR 文件的結構正確性
 * 若版本不符，會自動嘗試遷移後再驗證
 */
export function validateFlowIR(ir: FlowIR): ValidationResult {
  const errors: ValidationError[] = [];
  const nodeMap = new Map<NodeId, FlowNode>(ir.nodes.map((n) => [n.id, n]));

  // 1. 版本處理：自動遷移
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
          message: `IR 版本遷移失敗: ${err.message}`,
        });
      } else {
        errors.push({
          code: "INVALID_VERSION",
          message: `不支援的 IR 版本: ${ir.version}`,
        });
      }
    }
  }

  // 驗證遷移後（或原始）的版本
  if (!migrated && workingIR.version !== CURRENT_IR_VERSION) {
    errors.push({
      code: "INVALID_VERSION",
      message: `不支援的 IR 版本: ${workingIR.version}（目前支援: ${CURRENT_IR_VERSION}）`,
    });
  }

  // 2. 檢查必須有且僅有一個 Trigger
  const triggers = ir.nodes.filter(
    (n) => n.category === NodeCategory.TRIGGER
  );
  if (triggers.length === 0) {
    errors.push({
      code: "NO_TRIGGER",
      message: "工作流必須包含至少一個觸發器節點",
    });
  }
  if (triggers.length > 1) {
    errors.push({
      code: "MULTIPLE_TRIGGERS",
      message: `工作流只能有一個觸發器，目前有 ${triggers.length} 個`,
    });
  }

  // 3. 檢查節點 ID 唯一性
  const idSet = new Set<string>();
  for (const node of ir.nodes) {
    if (idSet.has(node.id)) {
      errors.push({
        code: "DUPLICATE_NODE_ID",
        message: `重複的節點 ID: ${node.id}`,
        nodeId: node.id,
      });
    }
    idSet.add(node.id);
  }

  // 4. 驗證所有 Edge 的端點
  for (const edge of ir.edges) {
    if (!nodeMap.has(edge.sourceNodeId)) {
      errors.push({
        code: "INVALID_EDGE_SOURCE",
        message: `Edge "${edge.id}" 的來源節點 "${edge.sourceNodeId}" 不存在`,
        edgeId: edge.id,
      });
    }
    if (!nodeMap.has(edge.targetNodeId)) {
      errors.push({
        code: "INVALID_EDGE_TARGET",
        message: `Edge "${edge.id}" 的目標節點 "${edge.targetNodeId}" 不存在`,
        edgeId: edge.id,
      });
    }
  }

  // 5. 檢測環路 (Cycle Detection via DFS)
  const cycleErrors = detectCycles(ir.nodes, ir.edges);
  errors.push(...cycleErrors);

  // 6. 檢查孤立節點（沒有任何連線，且非 Trigger）
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
        message: `節點 "${node.id}" (${node.label}) 未連接到任何其他節點`,
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
 * 使用 DFS 檢測有向圖中的環路
 */
function detectCycles(
  nodes: FlowNode[],
  edges: FlowEdge[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 建立鄰接表
  const adjacency = new Map<NodeId, NodeId[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const WHITE = 0; // 未訪問
  const GRAY = 1; // 正在訪問（在當前 DFS 路徑上）
  const BLACK = 2; // 已完成

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
          message: `檢測到環路：節點 "${nodeId}" → "${neighbor}"`,
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
