/**
 * useHighlightFromURL — URL Deep Link 節點高亮 hook
 *
 * 當 URL 包含 `?highlight=nodeId` 時，自動選取該節點並滾動到畫布位置。
 * 搭配 Runtime Tracer 的 deep link 使用。
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

    // 等節點載入完成後再選取
    const targetNode = nodes.find((n) => n.id === highlightId);
    if (targetNode) {
      selectNode(highlightId);

      // 清除 URL 參數（避免重複觸發）
      const url = new URL(window.location.href);
      url.searchParams.delete("highlight");
      window.history.replaceState({}, "", url.toString());
    }
  }, [nodes, selectNode]);
}
