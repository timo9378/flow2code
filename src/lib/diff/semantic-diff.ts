/**
 * Flow2Code Semantic Diff Engine
 *
 * Compares two FlowIR versions, producing human-readable semantic diff descriptions.
 * Replaces the noise of raw JSON diffs, letting PR reviews see "what logic was added" instead of "which bytes changed".
 *
 * Comparison levels:
 *   1. Meta: name, description changes
 *   2. Nodes: added / removed / modified nodes
 *   3. Edges: added / removed edges
 *   4. Params: node parameter detail changes
 */

import type { FlowIR, FlowNode, FlowEdge, NodeId } from "../ir/types";

// ============================================================
// Public Types
// ============================================================

export type ChangeType = "added" | "removed" | "modified";
export type ChangeCategory = "meta" | "node" | "edge";

export interface SemanticChange {
  /** Change type */
  type: ChangeType;
  /** Change category */
  category: ChangeCategory;
  /** Affected ID (nodeId or edgeId) */
  id: string;
  /** Human-readable description */
  description: string;
  /** Detailed field differences for modifications */
  details?: FieldDiff[];
}

export interface FieldDiff {
  /** Field path, e.g. "params.url" or "label" */
  field: string;
  /** Old value */
  before: unknown;
  /** New value */
  after: unknown;
}

export interface DiffSummary {
  /** All changes */
  changes: SemanticChange[];
  /** Quick statistics */
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
 * Compute semantic differences between two FlowIRs
 *
 * @param before - IR before changes
 * @param after - IR after changes
 * @returns Semantic diff summary
 */
export function semanticDiff(before: FlowIR, after: FlowIR): DiffSummary {
  const changes: SemanticChange[] = [];

  // 1. Compare Meta
  diffMeta(before, after, changes);

  // 2. Compare Nodes
  diffNodes(before.nodes, after.nodes, changes);

  // 3. Compare Edges
  diffEdges(before.edges, after.edges, changes);

  // Statistics
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
      description: `Workflow meta changed: ${details.map((d) => d.field).join(", ")}`,
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

  // Added nodes
  for (const [id, node] of afterMap) {
    if (!beforeMap.has(id)) {
      changes.push({
        type: "added",
        category: "node",
        id,
        description: `Added node: "${node.label}" (${node.nodeType}, ${node.category})`,
      });
    }
  }

  // Removed nodes
  for (const [id, node] of beforeMap) {
    if (!afterMap.has(id)) {
      changes.push({
        type: "removed",
        category: "node",
        id,
        description: `Removed node: "${node.label}" (${node.nodeType}, ${node.category})`,
      });
    }
  }

  // Modified nodes
  for (const [id, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(id);
    if (!afterNode) continue;

    const details = diffNodeFields(beforeNode, afterNode);
    if (details.length > 0) {
      changes.push({
        type: "modified",
        category: "node",
        id,
        description: `Modified node: "${beforeNode.label}" — ${summarizeFieldChanges(details)}`,
        details,
      });
    }
  }
}

function diffNodeFields(before: FlowNode, after: FlowNode): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Directly compare simple fields
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

  // Deep compare params
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

  // Added edges
  for (const [id, edge] of afterMap) {
    if (!beforeMap.has(id)) {
      changes.push({
        type: "added",
        category: "edge",
        id,
        description: `Added edge: ${edge.sourceNodeId}:${edge.sourcePortId} → ${edge.targetNodeId}:${edge.targetPortId}`,
      });
    }
  }

  // Removed edges
  for (const [id, edge] of beforeMap) {
    if (!afterMap.has(id)) {
      changes.push({
        type: "removed",
        category: "edge",
        id,
        description: `Removed edge: ${edge.sourceNodeId}:${edge.sourcePortId} → ${edge.targetNodeId}:${edge.targetPortId}`,
      });
    }
  }

  // Modified edges
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
        description: `Modified edge: ${beforeEdge.sourceNodeId} → ${beforeEdge.targetNodeId} — ${summarizeFieldChanges(details)}`,
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
    return `${d.field} changed from "${String(d.before)}" to "${String(d.after)}"`;
  }
  return `${details.length} field(s) changed (${details.map((d) => d.field).join(", ")})`;
}

/**
 * Format diff summary into a human-readable text report
 */
export function formatDiff(summary: DiffSummary): string {
  const lines: string[] = [];
  const { changes, stats } = summary;

  if (stats.total === 0) {
    return "✅ No differences";
  }

  lines.push(
    `📊 Diff summary: +${stats.added} added, -${stats.removed} removed, ✏️ ${stats.modified} modified`
  );
  lines.push("");

  // Group by category
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
