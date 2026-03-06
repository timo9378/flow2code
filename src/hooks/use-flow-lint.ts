/**
 * useFlowLint — Live linting hook
 *
 * Reactively validates the current flow IR on every store change (debounced),
 * pushing lint-type badges to the store for visual feedback on the canvas.
 */

"use client";

import { useEffect, useRef } from "react";
import { useFlowStore } from "@/store/flow-store";
import { validateFlowIR } from "@/lib/ir/validator";
import type { NodeBadgeMap } from "@/store/flow-store";

const DEBOUNCE_MS = 500;

export function useFlowLint() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const clearBadges = useFlowStore((s) => s.clearBadges);
  const setNodeBadges = useFlowStore((s) => s.setNodeBadges);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      // Build a minimal IR for validation
      const ir = useFlowStore.getState().exportIR();
      const result = validateFlowIR(ir);

      // Build badge map from validation errors
      const badges: NodeBadgeMap = {};
      for (const err of result.errors) {
        const nodeId = err.nodeId ?? err.edgeId;
        if (!nodeId) continue;

        // For edge errors, apply badge to both source and target
        if (err.edgeId) {
          const edge = ir.edges.find((e) => e.id === err.edgeId);
          if (edge) {
            for (const nid of [edge.sourceNodeId, edge.targetNodeId]) {
              if (!badges[nid]) badges[nid] = [];
              badges[nid].push({
                type: err.severity === "warning" ? "warning" : err.severity === "info" ? "info" : "error",
                message: err.message,
                source: "lint",
              });
            }
            continue;
          }
        }

        if (!badges[nodeId]) badges[nodeId] = [];
        badges[nodeId].push({
          type: err.severity === "warning" ? "warning" : err.severity === "info" ? "info" : "error",
          message: err.message,
          source: "lint",
        });
      }

      // Merge with existing trace badges (keep trace, replace lint)
      const currentBadges = useFlowStore.getState().nodeBadges;
      const merged: NodeBadgeMap = {};

      // Keep trace badges
      for (const [nid, existing] of Object.entries(currentBadges)) {
        const traceBadges = existing.filter((b) => b.source === "trace");
        if (traceBadges.length > 0) merged[nid] = traceBadges;
      }

      // Add lint badges
      for (const [nid, lintBadges] of Object.entries(badges)) {
        merged[nid] = [...(merged[nid] ?? []), ...lintBadges];
      }

      setNodeBadges(merged);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, clearBadges, setNodeBadges]);
}
