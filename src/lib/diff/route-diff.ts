/**
 * Flow2Code Route Diff — semantic flow diff between two TypeScript versions
 *
 * The PR-review workhorse: decompiles two versions of an API route and
 * reports what changed in the *control/data flow*, not in the text.
 *
 * The hard part is node alignment. Decompiled node IDs are positional
 * (`if_1`, `if_2`, …), so inserting one statement shifts every later ID and
 * a naive ID-based diff reports the whole file as rewritten. We align nodes
 * by content fingerprint first, then by type+label, then by fuzzy content
 * similarity — only what's genuinely unmatched is reported as added/removed.
 */

import type { FlowIR, FlowNode } from "../ir/types";
import { NodeCategory, LogicType, OutputType } from "../ir/types";
import { decompile, type AuditHint } from "../compiler/decompiler";
import { toMermaid } from "./mermaid";

// ============================================================
// Public Types
// ============================================================

export type RouteChangeType = "added" | "removed" | "modified";

/** How much reviewer attention a change deserves. */
export type RouteChangeSeverity = "info" | "notice" | "warning";

export interface RouteChange {
  type: RouteChangeType;
  severity: RouteChangeSeverity;
  /** Reviewer-facing one-liner, e.g. `Error response path removed: Response 502` */
  description: string;
  nodeType: string;
  label: string;
  /** Node ID in the after-IR (added/modified) or before-IR (removed) */
  nodeId: string;
  /** Field-level before/after for modifications */
  fieldChanges?: { field: string; before: unknown; after: unknown }[];
}

export interface RouteDiffResult {
  success: boolean;
  errors?: string[];
  changes: RouteChange[];
  /** Audit warnings present after but not before (newly introduced) */
  newWarnings: AuditHint[];
  /** Audit warnings present before but not after (resolved) */
  resolvedWarnings: AuditHint[];
  stats: { added: number; removed: number; modified: number; unchanged: number };
  beforeIR?: FlowIR;
  afterIR?: FlowIR;
  /** Lower bound of both decompile confidences */
  confidence: number;
}

export interface RouteDiffOptions {
  /** File name used for route inference and report headers */
  fileName?: string;
}

// ============================================================
// Node Alignment
// ============================================================

interface Alignment {
  pairs: { before: FlowNode; after: FlowNode }[];
  added: FlowNode[];
  removed: FlowNode[];
}

function normalize(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Content fingerprint: stable across ID renumbering. */
function fingerprint(node: FlowNode): string {
  const p = node.params as Record<string, unknown>;
  let essence: string;
  switch (node.nodeType) {
    case LogicType.IF_ELSE:
      essence = normalize(p.condition);
      break;
    case OutputType.RETURN_RESPONSE:
      essence = `${p.statusCode ?? ""}:${normalize(p.bodyExpression)}`;
      break;
    case "custom_code":
      essence = normalize(p.code);
      break;
    case "fetch_api":
      essence = `${normalize(p.method)}:${normalize(p.url)}`;
      break;
    case "declare":
      essence = `${normalize(p.name)}:${normalize(p.initialValue)}`;
      break;
    case "transform":
      essence = normalize(p.expression);
      break;
    default:
      essence = normalize(node.label);
  }
  return `${node.nodeType}::${essence}`;
}

/** Token-set similarity in [0, 1] for fuzzy matching of edited nodes. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9$_]+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9$_]+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

function alignNodes(before: FlowIR, after: FlowIR): Alignment {
  const pairs: Alignment["pairs"] = [];
  const beforeLeft = new Set(before.nodes);
  const afterLeft = new Set(after.nodes);

  // Pass 1: exact fingerprint matches. Duplicate fingerprints pair in
  // document order, which keeps repeated patterns (e.g. identical guards) stable.
  const afterByFp = new Map<string, FlowNode[]>();
  for (const n of afterLeft) {
    const fp = fingerprint(n);
    if (!afterByFp.has(fp)) afterByFp.set(fp, []);
    afterByFp.get(fp)!.push(n);
  }
  for (const b of [...beforeLeft]) {
    const bucket = afterByFp.get(fingerprint(b));
    const a = bucket?.shift();
    if (a) {
      pairs.push({ before: b, after: a });
      beforeLeft.delete(b);
      afterLeft.delete(a);
    }
  }

  // Pass 2: same nodeType + best content similarity above threshold.
  // These are "the same node, edited" — they become `modified` entries.
  for (const b of [...beforeLeft]) {
    let best: FlowNode | null = null;
    let bestScore = 0;
    for (const a of afterLeft) {
      if (a.nodeType !== b.nodeType) continue;
      const score = similarity(fingerprint(b), fingerprint(a));
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (best && bestScore >= 0.4) {
      pairs.push({ before: b, after: best });
      beforeLeft.delete(b);
      afterLeft.delete(best);
    }
  }

  return { pairs, added: [...afterLeft], removed: [...beforeLeft] };
}

// ============================================================
// Reviewer-level Classification
// ============================================================

function isErrorStatus(node: FlowNode): boolean {
  const status = Number((node.params as Record<string, unknown>).statusCode);
  return Number.isFinite(status) && status >= 400;
}

function classifyAdded(node: FlowNode): RouteChange {
  let severity: RouteChangeSeverity = "info";
  let description = `Added: ${node.label} (${node.nodeType})`;

  if (node.nodeType === "fetch_api" || node.nodeType === "sql_query" || node.nodeType === "custom_code") {
    severity = "notice";
    description = `New operation: ${node.label}`;
  } else if (node.nodeType === LogicType.IF_ELSE) {
    severity = "notice";
    description = `New branch: ${node.label}`;
  } else if (node.nodeType === LogicType.TRY_CATCH) {
    description = `Error handling added: ${node.label}`;
  } else if (node.nodeType === OutputType.RETURN_RESPONSE) {
    description = `New response path: ${node.label}`;
  }

  return { type: "added", severity, description, nodeType: node.nodeType, label: node.label, nodeId: node.id };
}

function classifyRemoved(node: FlowNode): RouteChange {
  let severity: RouteChangeSeverity = "info";
  let description = `Removed: ${node.label} (${node.nodeType})`;

  if (node.nodeType === LogicType.TRY_CATCH) {
    severity = "warning";
    description = `Error handling removed: ${node.label}`;
  } else if (node.nodeType === OutputType.RETURN_RESPONSE && isErrorStatus(node)) {
    severity = "warning";
    description = `Error response path removed: ${node.label}`;
  } else if (node.nodeType === OutputType.RETURN_RESPONSE) {
    severity = "notice";
    description = `Response path removed: ${node.label}`;
  } else if (node.nodeType === LogicType.IF_ELSE) {
    severity = "notice";
    description = `Branch removed: ${node.label}`;
  }

  return { type: "removed", severity, description, nodeType: node.nodeType, label: node.label, nodeId: node.id };
}

function classifyModified(before: FlowNode, after: FlowNode): RouteChange | null {
  const fieldChanges: RouteChange["fieldChanges"] = [];
  const bp = before.params as Record<string, unknown>;
  const ap = after.params as Record<string, unknown>;
  const keys = new Set([...Object.keys(bp), ...Object.keys(ap)]);
  for (const key of keys) {
    if (normalize(JSON.stringify(bp[key] ?? null)) !== normalize(JSON.stringify(ap[key] ?? null))) {
      fieldChanges.push({ field: `params.${key}`, before: bp[key], after: ap[key] });
    }
  }
  if (before.label !== after.label && fieldChanges.length === 0) {
    fieldChanges.push({ field: "label", before: before.label, after: after.label });
  }
  if (fieldChanges.length === 0) return null;

  let severity: RouteChangeSeverity = "info";
  let description = `Modified: ${after.label}`;

  if (after.nodeType === LogicType.IF_ELSE) {
    severity = "notice";
    description = `Branch condition changed: \`${normalize(bp.condition)}\` → \`${normalize(ap.condition)}\``;
  } else if (after.nodeType === OutputType.RETURN_RESPONSE && bp.statusCode !== ap.statusCode) {
    severity = "notice";
    description = `Response status changed: ${bp.statusCode} → ${ap.statusCode}`;
  } else if (after.nodeType === "fetch_api") {
    severity = "notice";
    description = `External call changed: ${after.label}`;
  }

  return {
    type: "modified", severity, description,
    nodeType: after.nodeType, label: after.label, nodeId: after.id, fieldChanges,
  };
}

// ============================================================
// Audit Delta
// ============================================================

function auditKey(hint: AuditHint): string {
  // line numbers shift between versions; identity is severity + message
  return `${hint.severity}::${hint.message}`;
}

function auditDelta(before: AuditHint[], after: AuditHint[]) {
  const beforeKeys = new Map<string, number>();
  for (const h of before) beforeKeys.set(auditKey(h), (beforeKeys.get(auditKey(h)) ?? 0) + 1);

  const newWarnings: AuditHint[] = [];
  const afterKeys = new Map<string, number>();
  for (const h of after) {
    const key = auditKey(h);
    afterKeys.set(key, (afterKeys.get(key) ?? 0) + 1);
    const remaining = beforeKeys.get(key) ?? 0;
    if (remaining > 0) beforeKeys.set(key, remaining - 1);
    else newWarnings.push(h);
  }

  const resolvedWarnings: AuditHint[] = [];
  const consumed = new Map<string, number>();
  for (const h of before) {
    const key = auditKey(h);
    const available = afterKeys.get(key) ?? 0;
    const used = consumed.get(key) ?? 0;
    if (used < available) consumed.set(key, used + 1);
    else resolvedWarnings.push(h);
  }

  return { newWarnings, resolvedWarnings };
}

// ============================================================
// Main Entry
// ============================================================

/** Diffs two TypeScript sources at the flow level. */
export function diffRoutes(
  beforeCode: string,
  afterCode: string,
  options: RouteDiffOptions = {}
): RouteDiffResult {
  const fileName = options.fileName ?? "route.ts";
  const before = decompile(beforeCode, { fileName, audit: true });
  const after = decompile(afterCode, { fileName, audit: true });

  if (!before.success || !after.success) {
    return {
      success: false,
      errors: [
        ...(before.success ? [] : [`before: ${(before.errors ?? ["decompile failed"]).join("; ")}`]),
        ...(after.success ? [] : [`after: ${(after.errors ?? ["decompile failed"]).join("; ")}`]),
      ],
      changes: [], newWarnings: [], resolvedWarnings: [],
      stats: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      confidence: 0,
    };
  }

  return diffIRs(before.ir!, after.ir!, {
    beforeAudit: before.audit ?? [],
    afterAudit: after.audit ?? [],
    confidence: Math.min(before.confidence, after.confidence),
  });
}

/** Diffs two already-decompiled IRs (used by diffRoutes and the .flow.json path). */
export function diffIRs(
  beforeIR: FlowIR,
  afterIR: FlowIR,
  extras: { beforeAudit?: AuditHint[]; afterAudit?: AuditHint[]; confidence?: number } = {}
): RouteDiffResult {
  const alignment = alignNodes(beforeIR, afterIR);
  const changes: RouteChange[] = [];

  for (const node of alignment.added) changes.push(classifyAdded(node));
  for (const node of alignment.removed) changes.push(classifyRemoved(node));
  let unchanged = 0;
  for (const { before, after } of alignment.pairs) {
    const change = classifyModified(before, after);
    if (change) changes.push(change);
    else unchanged++;
  }

  // warnings first, then notices — reviewers read top-down
  const order: Record<RouteChangeSeverity, number> = { warning: 0, notice: 1, info: 2 };
  changes.sort((a, b) => order[a.severity] - order[b.severity]);

  const { newWarnings, resolvedWarnings } = auditDelta(
    extras.beforeAudit ?? [], extras.afterAudit ?? []
  );

  return {
    success: true,
    changes,
    newWarnings,
    resolvedWarnings,
    stats: {
      added: alignment.added.length,
      removed: alignment.removed.length,
      modified: changes.filter((c) => c.type === "modified").length,
      unchanged,
    },
    beforeIR,
    afterIR,
    confidence: extras.confidence ?? 1,
  };
}

// ============================================================
// Markdown Report (PR comment format)
// ============================================================

const SEVERITY_ICON: Record<RouteChangeSeverity, string> = {
  warning: "⚠️",
  notice: "🟡",
  info: "▫️",
};
const TYPE_ICON: Record<RouteChangeType, string> = {
  added: "🟢",
  removed: "🔴",
  modified: "✏️",
};

/** Formats a RouteDiffResult as a GitHub-flavored Markdown PR comment section. */
export function formatRouteDiffMarkdown(
  result: RouteDiffResult,
  options: { fileName?: string; routeLabel?: string } = {}
): string {
  const lines: string[] = [];
  const file = options.fileName ?? "route";

  if (!result.success) {
    lines.push(`#### \`${file}\``);
    lines.push("");
    lines.push(`> Could not analyze this file: ${(result.errors ?? []).join("; ")}`);
    return lines.join("\n");
  }

  const trigger = result.afterIR?.nodes.find((n) => n.category === NodeCategory.TRIGGER);
  const routeLabel = options.routeLabel ?? trigger?.label ?? "";
  const { stats } = result;

  lines.push(`#### \`${file}\`${routeLabel ? ` — **${routeLabel}**` : ""}`);
  lines.push("");

  if (result.changes.length === 0) {
    lines.push("No flow-level changes (refactor only — structure is identical).");
    return lines.join("\n");
  }

  lines.push(
    `${stats.added} added · ${stats.removed} removed · ${stats.modified} modified · ` +
    `${stats.unchanged} unchanged · confidence ${(result.confidence * 100).toFixed(0)}%`
  );
  lines.push("");

  for (const change of result.changes) {
    lines.push(`- ${SEVERITY_ICON[change.severity]} ${TYPE_ICON[change.type]} ${change.description}`);
  }

  if (result.newWarnings.length > 0) {
    lines.push("");
    lines.push("**🆕 New audit warnings introduced:**");
    for (const w of result.newWarnings) {
      lines.push(`- [${w.severity}] ${w.message}${w.line ? ` (line ${w.line})` : ""}`);
    }
  }
  if (result.resolvedWarnings.length > 0) {
    lines.push("");
    lines.push("**✅ Audit warnings resolved:**");
    for (const w of result.resolvedWarnings) {
      lines.push(`- [${w.severity}] ${w.message}`);
    }
  }

  if (result.afterIR) {
    const mermaid = toMermaid(result.afterIR, {
      addedNodeIds: new Set(result.changes.filter((c) => c.type === "added").map((c) => c.nodeId)),
      modifiedNodeIds: new Set(result.changes.filter((c) => c.type === "modified").map((c) => c.nodeId)),
    });
    if (mermaid) {
      lines.push("");
      lines.push("<details><summary>Flow graph (after — 🟢 added, 🟠 modified)</summary>");
      lines.push("");
      lines.push("```mermaid");
      lines.push(mermaid);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }
  }

  return lines.join("\n");
}
