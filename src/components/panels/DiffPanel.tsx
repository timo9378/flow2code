"use client";

/**
 * DiffPanel — Git-style Visual Diff UI
 *
 * Compares two history snapshots using the semantic-diff engine.
 * Shows added / removed / modified nodes with color coding.
 * Sets node badges on the canvas to visually highlight changes.
 */

import { useState, useMemo, useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import type { HistoryEntry, FlowNodeData, NodeBadgeMap } from "@/store/flow-store";
import { semanticDiff, type DiffSummary, type SemanticChange } from "@/lib/diff/semantic-diff";
import type { FlowIR, FlowNode, FlowEdge } from "@/lib/ir/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Node, Edge } from "@xyflow/react";

// ── Helpers ──

/** Convert a history snapshot to FlowIR for semantic diff */
function snapshotToIR(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  label: string
): FlowIR {
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
      name: label,
      description: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    nodes: irNodes,
    edges: irEdges,
  };
}

function changeIcon(type: SemanticChange["type"]): string {
  switch (type) {
    case "added":
      return "🟢";
    case "removed":
      return "🔴";
    case "modified":
      return "🟡";
    default:
      return "⚪";
  }
}

function changeColor(type: SemanticChange["type"]): string {
  switch (type) {
    case "added":
      return "text-emerald-400";
    case "removed":
      return "text-red-400";
    case "modified":
      return "text-yellow-400";
    default:
      return "text-muted-foreground";
  }
}

// ── Component ──

interface DiffPanelProps {
  onApplyHighlights?: (summary: DiffSummary) => void;
}

export default function DiffPanel({ onApplyHighlights }: DiffPanelProps) {
  const flowHistory = useFlowStore((s) => s.flowHistory);
  const currentNodes = useFlowStore((s) => s.nodes);
  const currentEdges = useFlowStore((s) => s.edges);
  const setNodeBadges = useFlowStore((s) => s.setNodeBadges);

  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string>("__current__");

  // Build options list: history entries + current state
  const options = useMemo(() => {
    const items: { id: string; label: string; timestamp: string }[] = flowHistory.map((h) => ({
      id: h.id,
      label: h.label,
      timestamp: h.timestamp,
    }));
    items.push({ id: "__current__", label: "Current State", timestamp: new Date().toISOString() });
    return items;
  }, [flowHistory]);

  // Compute diff
  const diffResult = useMemo<DiffSummary | null>(() => {
    if (!beforeId || !afterId || beforeId === afterId) return null;

    const getIR = (id: string): FlowIR | null => {
      if (id === "__current__") {
        return snapshotToIR(currentNodes, currentEdges, "Current State");
      }
      const entry = flowHistory.find((h) => h.id === id);
      if (!entry) return null;
      return snapshotToIR(
        entry.snapshot.nodes as Node<FlowNodeData>[],
        entry.snapshot.edges,
        entry.label
      );
    };

    const beforeIR = getIR(beforeId);
    const afterIR = getIR(afterId);
    if (!beforeIR || !afterIR) return null;

    return semanticDiff(beforeIR, afterIR);
  }, [beforeId, afterId, flowHistory, currentNodes, currentEdges]);

  // Apply diff highlights to canvas nodes as badges
  const handleApplyHighlights = useCallback(() => {
    if (!diffResult) return;

    const badges: NodeBadgeMap = {};
    for (const change of diffResult.changes) {
      if (change.category !== "node") continue;

      const nodeId = change.id;
      if (!badges[nodeId]) badges[nodeId] = [];

      if (change.type === "added") {
        badges[nodeId].push({
          type: "info",
          message: `Added: ${change.description}`,
          source: "lint",
        });
      } else if (change.type === "removed") {
        badges[nodeId].push({
          type: "error",
          message: `Removed: ${change.description}`,
          source: "lint",
        });
      } else if (change.type === "modified") {
        badges[nodeId].push({
          type: "warning",
          message: `Modified: ${change.description}`,
          source: "lint",
        });
      }
    }

    setNodeBadges(badges);
    onApplyHighlights?.(diffResult);
  }, [diffResult, setNodeBadges, onApplyHighlights]);

  const handleClearHighlights = useCallback(() => {
    setNodeBadges({});
  }, [setNodeBadges]);

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Snapshot selectors */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">
            Before (Base)
          </label>
          <select
            className="w-full bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border"
            value={beforeId ?? ""}
            onChange={(e) => setBeforeId(e.target.value || null)}
          >
            <option value="">Select snapshot...</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({new Date(o.timestamp).toLocaleTimeString()})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">
            After (Compare)
          </label>
          <select
            className="w-full bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border"
            value={afterId}
            onChange={(e) => setAfterId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({new Date(o.timestamp).toLocaleTimeString()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Diff statistics */}
      {diffResult && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent/20 rounded-md">
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400">
            +{diffResult.stats.added} added
          </Badge>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-red-500/20 text-red-400">
            -{diffResult.stats.removed} removed
          </Badge>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-yellow-500/20 text-yellow-400">
            ~{diffResult.stats.modified} modified
          </Badge>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {diffResult.stats.total} total changes
          </span>
        </div>
      )}

      {/* Changes list */}
      {diffResult && diffResult.changes.length > 0 ? (
        <ScrollArea className="flex-1 max-h-[40vh]">
          <div className="flex flex-col gap-1 pr-2">
            {diffResult.changes.map((change, i) => (
              <div
                key={`${change.id}-${i}`}
                className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-accent/30 transition-colors"
              >
                <span className="text-sm shrink-0 pt-0.5">{changeIcon(change.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-tight ${changeColor(change.type)}`}>
                    {change.description}
                  </p>
                  {change.details && change.details.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {change.details.map((d, j) => (
                        <p key={j} className="text-[10px] text-muted-foreground font-mono">
                          {d.field}:{" "}
                          <span className="text-red-400 line-through">{String(d.before)}</span>
                          {" → "}
                          <span className="text-emerald-400">{String(d.after)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className="text-[8px] px-1 py-0 shrink-0"
                >
                  {change.category}
                </Badge>
              </div>
            ))}
          </div>
          <ScrollBar orientation="vertical" />
        </ScrollArea>
      ) : diffResult ? (
        <div className="text-center py-8 text-muted-foreground text-xs">
          No changes detected between the two snapshots.
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-xs">
          Select two snapshots to compare.
        </div>
      )}

      {/* Actions */}
      {diffResult && diffResult.changes.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={handleApplyHighlights}
          >
            🎨 Highlight on Canvas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={handleClearHighlights}
          >
            Clear Highlights
          </Button>
        </div>
      )}
    </div>
  );
}
