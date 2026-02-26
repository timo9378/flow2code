/**
 * Flow2Code Semantic Diff Engine
 *
 * 比較兩個 FlowIR 版本，產出人類可讀的語意化差異描述。
 * 取代純 JSON diff 的雜訊，讓 PR Review 能看到「加了什麼邏輯」而非「哪些 byte 變了」。
 *
 * 比較層級：
 *   1. Meta：名稱、描述變更
 *   2. Nodes：新增 / 移除 / 修改節點
 *   3. Edges：新增 / 移除連線
 *   4. Params：節點參數細項變更
 */

import type { FlowIR, FlowNode, FlowEdge, NodeId } from "../ir/types";

// ============================================================
// Public Types
// ============================================================

export type ChangeType = "added" | "removed" | "modified";
export type ChangeCategory = "meta" | "node" | "edge";

export interface SemanticChange {
  /** 變更類型 */
  type: ChangeType;
  /** 變更範疇 */
  category: ChangeCategory;
  /** 受影響的 ID（nodeId 或 edgeId） */
  id: string;
  /** 人類可讀的描述 */
  description: string;
  /** 修改的詳細欄位差異 */
  details?: FieldDiff[];
}

export interface FieldDiff {
  /** 欄位路徑，如 "params.url" 或 "label" */
  field: string;
  /** 舊值 */
  before: unknown;
  /** 新值 */
  after: unknown;
}

export interface DiffSummary {
  /** 所有差異 */
  changes: SemanticChange[];
  /** 快速統計 */
  stats: {
    added: number;
    removed: number;
    modified: number;
    total: number;
  };
}

// ============================================================
// Main Diff Function
// ============================================================

/**
 * 計算兩個 FlowIR 之間的語意化差異
 *
 * @param before - 變更前的 IR
 * @param after - 變更後的 IR
 * @returns 語意化差異摘要
 */
export function semanticDiff(before: FlowIR, after: FlowIR): DiffSummary {
  const changes: SemanticChange[] = [];

  // 1. 比較 Meta
  diffMeta(before, after, changes);

  // 2. 比較 Nodes
  diffNodes(before.nodes, after.nodes, changes);

  // 3. 比較 Edges
  diffEdges(before.edges, after.edges, changes);

  // 統計
  const stats = {
    added: changes.filter((c) => c.type === "added").length,
    removed: changes.filter((c) => c.type === "removed").length,
    modified: changes.filter((c) => c.type === "modified").length,
    total: changes.length,
  };

  return { changes, stats };
}

// ============================================================
// Meta Diff
// ============================================================

function diffMeta(
  before: FlowIR,
  after: FlowIR,
  changes: SemanticChange[]
): void {
  const details: FieldDiff[] = [];

  if (before.meta.name !== after.meta.name) {
    details.push({
      field: "meta.name",
      before: before.meta.name,
      after: after.meta.name,
    });
  }

  if (before.meta.description !== after.meta.description) {
    details.push({
      field: "meta.description",
      before: before.meta.description,
      after: after.meta.description,
    });
  }

  if (before.version !== after.version) {
    details.push({
      field: "version",
      before: before.version,
      after: after.version,
    });
  }

  if (details.length > 0) {
    changes.push({
      type: "modified",
      category: "meta",
      id: "meta",
      description: `工作流 meta 已變更: ${details.map((d) => d.field).join(", ")}`,
      details,
    });
  }
}

// ============================================================
// Node Diff
// ============================================================

function diffNodes(
  beforeNodes: FlowNode[],
  afterNodes: FlowNode[],
  changes: SemanticChange[]
): void {
  const beforeMap = new Map<NodeId, FlowNode>(
    beforeNodes.map((n) => [n.id, n])
  );
  const afterMap = new Map<NodeId, FlowNode>(
    afterNodes.map((n) => [n.id, n])
  );

  // 新增的節點
  for (const [id, node] of afterMap) {
    if (!beforeMap.has(id)) {
      changes.push({
        type: "added",
        category: "node",
        id,
        description: `新增節點: "${node.label}" (${node.nodeType}, ${node.category})`,
      });
    }
  }

  // 移除的節點
  for (const [id, node] of beforeMap) {
    if (!afterMap.has(id)) {
      changes.push({
        type: "removed",
        category: "node",
        id,
        description: `移除節點: "${node.label}" (${node.nodeType}, ${node.category})`,
      });
    }
  }

  // 修改的節點
  for (const [id, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(id);
    if (!afterNode) continue;

    const details = diffNodeFields(beforeNode, afterNode);
    if (details.length > 0) {
      changes.push({
        type: "modified",
        category: "node",
        id,
        description: `修改節點: "${beforeNode.label}" — ${summarizeFieldChanges(details)}`,
        details,
      });
    }
  }
}

function diffNodeFields(before: FlowNode, after: FlowNode): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // 直接比較簡單欄位
  if (before.label !== after.label) {
    diffs.push({ field: "label", before: before.label, after: after.label });
  }
  if (before.nodeType !== after.nodeType) {
    diffs.push({
      field: "nodeType",
      before: before.nodeType,
      after: after.nodeType,
    });
  }
  if (before.category !== after.category) {
    diffs.push({
      field: "category",
      before: before.category,
      after: after.category,
    });
  }

  // 深度比較 params
  const paramDiffs = deepDiff(
    before.params as Record<string, unknown>,
    after.params as Record<string, unknown>,
    "params"
  );
  diffs.push(...paramDiffs);

  return diffs;
}

// ============================================================
// Edge Diff
// ============================================================

function diffEdges(
  beforeEdges: FlowEdge[],
  afterEdges: FlowEdge[],
  changes: SemanticChange[]
): void {
  const beforeMap = new Map(beforeEdges.map((e) => [e.id, e]));
  const afterMap = new Map(afterEdges.map((e) => [e.id, e]));

  // 新增的連線
  for (const [id, edge] of afterMap) {
    if (!beforeMap.has(id)) {
      changes.push({
        type: "added",
        category: "edge",
        id,
        description: `新增連線: ${edge.sourceNodeId}:${edge.sourcePortId} → ${edge.targetNodeId}:${edge.targetPortId}`,
      });
    }
  }

  // 移除的連線
  for (const [id, edge] of beforeMap) {
    if (!afterMap.has(id)) {
      changes.push({
        type: "removed",
        category: "edge",
        id,
        description: `移除連線: ${edge.sourceNodeId}:${edge.sourcePortId} → ${edge.targetNodeId}:${edge.targetPortId}`,
      });
    }
  }

  // 修改的連線
  for (const [id, beforeEdge] of beforeMap) {
    const afterEdge = afterMap.get(id);
    if (!afterEdge) continue;

    const details: FieldDiff[] = [];
    if (beforeEdge.sourceNodeId !== afterEdge.sourceNodeId) {
      details.push({
        field: "sourceNodeId",
        before: beforeEdge.sourceNodeId,
        after: afterEdge.sourceNodeId,
      });
    }
    if (beforeEdge.sourcePortId !== afterEdge.sourcePortId) {
      details.push({
        field: "sourcePortId",
        before: beforeEdge.sourcePortId,
        after: afterEdge.sourcePortId,
      });
    }
    if (beforeEdge.targetNodeId !== afterEdge.targetNodeId) {
      details.push({
        field: "targetNodeId",
        before: beforeEdge.targetNodeId,
        after: afterEdge.targetNodeId,
      });
    }
    if (beforeEdge.targetPortId !== afterEdge.targetPortId) {
      details.push({
        field: "targetPortId",
        before: beforeEdge.targetPortId,
        after: afterEdge.targetPortId,
      });
    }

    if (details.length > 0) {
      changes.push({
        type: "modified",
        category: "edge",
        id,
        description: `修改連線: ${beforeEdge.sourceNodeId} → ${beforeEdge.targetNodeId} — ${summarizeFieldChanges(details)}`,
        details,
      });
    }
  }
}

// ============================================================
// Deep Diff Utility
// ============================================================

function deepDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix: string
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const path = `${prefix}.${key}`;
    const bVal = before[key];
    const aVal = after[key];

    if (bVal === undefined && aVal !== undefined) {
      diffs.push({ field: path, before: undefined, after: aVal });
    } else if (bVal !== undefined && aVal === undefined) {
      diffs.push({ field: path, before: bVal, after: undefined });
    } else if (
      typeof bVal === "object" &&
      typeof aVal === "object" &&
      bVal !== null &&
      aVal !== null &&
      !Array.isArray(bVal) &&
      !Array.isArray(aVal)
    ) {
      diffs.push(
        ...deepDiff(
          bVal as Record<string, unknown>,
          aVal as Record<string, unknown>,
          path
        )
      );
    } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      diffs.push({ field: path, before: bVal, after: aVal });
    }
  }

  return diffs;
}

// ============================================================
// Formatting
// ============================================================

function summarizeFieldChanges(details: FieldDiff[]): string {
  if (details.length === 1) {
    const d = details[0];
    return `${d.field} 從 "${String(d.before)}" 改為 "${String(d.after)}"`;
  }
  return `${details.length} 個欄位變更 (${details.map((d) => d.field).join(", ")})`;
}

/**
 * 將差異摘要格式化為人類可讀的文字報告
 */
export function formatDiff(summary: DiffSummary): string {
  const lines: string[] = [];
  const { changes, stats } = summary;

  if (stats.total === 0) {
    return "✅ 無差異";
  }

  lines.push(
    `📊 差異摘要: +${stats.added} 新增, -${stats.removed} 移除, ✏️ ${stats.modified} 修改`
  );
  lines.push("");

  // 按類別分組
  const metaChanges = changes.filter((c) => c.category === "meta");
  const nodeChanges = changes.filter((c) => c.category === "node");
  const edgeChanges = changes.filter((c) => c.category === "edge");

  if (metaChanges.length > 0) {
    lines.push("── Meta ──");
    for (const change of metaChanges) {
      lines.push(`  ${getChangeIcon(change.type)} ${change.description}`);
      formatDetails(change.details, lines);
    }
    lines.push("");
  }

  if (nodeChanges.length > 0) {
    lines.push("── Nodes ──");
    for (const change of nodeChanges) {
      lines.push(`  ${getChangeIcon(change.type)} ${change.description}`);
      formatDetails(change.details, lines);
    }
    lines.push("");
  }

  if (edgeChanges.length > 0) {
    lines.push("── Edges ──");
    for (const change of edgeChanges) {
      lines.push(`  ${getChangeIcon(change.type)} ${change.description}`);
      formatDetails(change.details, lines);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatDetails(
  details: FieldDiff[] | undefined,
  lines: string[]
): void {
  if (!details || details.length === 0) return;
  for (const d of details) {
    const before = formatValue(d.before);
    const after = formatValue(d.after);
    lines.push(`      ${d.field}: ${before} → ${after}`);
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getChangeIcon(type: ChangeType): string {
  switch (type) {
    case "added":
      return "🟢";
    case "removed":
      return "🔴";
    case "modified":
      return "🟡";
  }
}
