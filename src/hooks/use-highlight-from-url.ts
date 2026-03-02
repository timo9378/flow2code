/**
 * useHighlightFromURL — URL Deep Link Node Highlight Hook
 *
 * When the URL contains `?highlight=nodeId`, automatically selects the node and scrolls to its canvas position.
 * Used with the Runtime Tracer's deep link.
 *
 * @example URL: http://localhost:3001?highlight=fetch_api_1
 */

import { useEffect } from "react";
import { useFlowStore } from "@/store/flow-store";

export function useHighlightFromURL() {
  const selectNode = useFlowStore((s) => s.selectNode);
  const nodes = useFlowStore((s) => s.nodes);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const highlightId = params.get("highlight");
    if (!highlightId) return;

    // Wait for nodes to finish loading before selecting
    const targetNode = nodes.find((n) => n.id === highlightId);
    if (targetNode) {
      selectNode(highlightId);

      // Clear URL parameters (avoid re-triggering)
      const url = new URL(window.location.href);
      url.searchParams.delete("highlight");
      window.history.replaceState({}, "", url.toString());
    }
  }, [nodes, selectNode]);
}
