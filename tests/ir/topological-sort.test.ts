/**
 * 拓撲排序測試
 */

import { describe, it, expect } from "vitest";
import { topologicalSort } from "@/lib/ir/topological-sort";
import {
  createSimpleGetFlow,
  createPostWithFetchFlow,
  createConcurrentFlow,
} from "../fixtures";

describe("Topological Sort", () => {
  it("應正確排序簡單的兩節點流程", () => {
    const ir = createSimpleGetFlow();
    const plan = topologicalSort(ir);

    expect(plan.sortedNodeIds).toHaveLength(2);
    expect(plan.sortedNodeIds[0]).toBe("trigger_1");
    expect(plan.sortedNodeIds[1]).toBe("response_1");
    expect(plan.steps).toHaveLength(2);
  });

  it("應正確排序三節點串列流程", () => {
    const ir = createPostWithFetchFlow();
    const plan = topologicalSort(ir);

    expect(plan.sortedNodeIds).toHaveLength(3);
    // trigger → fetch → response
    expect(plan.sortedNodeIds.indexOf("trigger_1")).toBeLessThan(
      plan.sortedNodeIds.indexOf("fetch_1")
    );
    expect(plan.sortedNodeIds.indexOf("fetch_1")).toBeLessThan(
      plan.sortedNodeIds.indexOf("response_1")
    );
  });

  it("應偵測可並發執行的節點", () => {
    const ir = createConcurrentFlow();
    const plan = topologicalSort(ir);

    // fetch_1 和 fetch_2 應在同一步驟（並發）
    const concurrentStep = plan.steps.find(
      (s) =>
        s.nodeIds.includes("fetch_1") && s.nodeIds.includes("fetch_2")
    );

    expect(concurrentStep).toBeDefined();
    expect(concurrentStep!.concurrent).toBe(true);
    expect(concurrentStep!.nodeIds).toHaveLength(2);
  });

  it("應正確計算依賴關係", () => {
    const ir = createPostWithFetchFlow();
    const plan = topologicalSort(ir);

    // response_1 依賴 fetch_1
    const responseDeps = plan.dependencies.get("response_1");
    expect(responseDeps).toBeDefined();
    expect(responseDeps!.has("fetch_1")).toBe(true);

    // trigger_1 沒有依賴
    const triggerDeps = plan.dependencies.get("trigger_1");
    expect(triggerDeps).toBeDefined();
    expect(triggerDeps!.size).toBe(0);
  });

  it("應對環路拋出錯誤", () => {
    // 手動建立帶環路的 IR（繞過驗證器）
    expect(() => {
      topologicalSort({
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [
          { id: "a", nodeType: "custom_code" as any, category: "action" as any, label: "A", params: {}, inputs: [], outputs: [] },
          { id: "b", nodeType: "custom_code" as any, category: "action" as any, label: "B", params: {}, inputs: [], outputs: [] },
        ],
        edges: [
          { id: "e1", sourceNodeId: "a", sourcePortId: "out", targetNodeId: "b", targetPortId: "in" },
          { id: "e2", sourceNodeId: "b", sourcePortId: "out", targetNodeId: "a", targetPortId: "in" },
        ],
      });
    }).toThrow("環路");
  });
});
