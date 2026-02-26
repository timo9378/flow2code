/**
 * Semantic Diff Engine 測試
 *
 * 驗證：節點差異、連線差異、Meta 差異、格式化輸出。
 */

import { describe, it, expect } from "vitest";
import { semanticDiff, formatDiff } from "@/lib/diff/semantic-diff";
import type { FlowIR } from "@/lib/ir/types";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";

describe("Semantic Diff Engine", () => {
  describe("無差異", () => {
    it("完全相同的 IR 應回傳零差異", () => {
      const ir = createSimpleGetFlow();
      const result = semanticDiff(ir, ir);

      expect(result.stats.total).toBe(0);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe("Meta 差異", () => {
    it("應偵測名稱變更", () => {
      const before = createSimpleGetFlow();
      const after = { ...createSimpleGetFlow(), meta: { ...before.meta, name: "Updated Name" } };

      const result = semanticDiff(before, after);
      const metaChange = result.changes.find(c => c.category === "meta");

      expect(metaChange).toBeDefined();
      expect(metaChange!.type).toBe("modified");
      expect(metaChange!.description).toContain("meta.name");
    });
  });

  describe("Node 差異", () => {
    it("應偵測新增節點", () => {
      const before = createSimpleGetFlow();
      const after = createPostWithFetchFlow(); // 多了 fetch_1 節點

      const result = semanticDiff(before, after);
      const addedNodes = result.changes.filter(
        (c) => c.category === "node" && c.type === "added"
      );

      expect(addedNodes.length).toBeGreaterThan(0);
    });

    it("應偵測移除節點", () => {
      const before = createPostWithFetchFlow();
      const after = createSimpleGetFlow();

      const result = semanticDiff(before, after);
      const removedNodes = result.changes.filter(
        (c) => c.category === "node" && c.type === "removed"
      );

      expect(removedNodes.length).toBeGreaterThan(0);
    });

    it("應偵測修改節點（label 變更）", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.nodes[0].label = "New Label";

      const result = semanticDiff(before, after);
      const modifiedNode = result.changes.find(
        (c) => c.category === "node" && c.type === "modified"
      );

      expect(modifiedNode).toBeDefined();
      expect(modifiedNode!.details).toBeDefined();
      expect(modifiedNode!.details!.some((d) => d.field === "label")).toBe(true);
    });

    it("應偵測節點參數變更", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      (after.nodes[1].params as any).statusCode = 201;

      const result = semanticDiff(before, after);
      const modifiedNode = result.changes.find(
        (c) => c.category === "node" && c.type === "modified" && c.id === "response_1"
      );

      expect(modifiedNode).toBeDefined();
      expect(
        modifiedNode!.details!.some((d) => d.field === "params.statusCode")
      ).toBe(true);
    });
  });

  describe("Edge 差異", () => {
    it("應偵測新增連線", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.edges.push({
        id: "e_new",
        sourceNodeId: "trigger_1",
        sourcePortId: "extra",
        targetNodeId: "response_1",
        targetPortId: "extra",
      });

      const result = semanticDiff(before, after);
      const addedEdge = result.changes.find(
        (c) => c.category === "edge" && c.type === "added"
      );

      expect(addedEdge).toBeDefined();
      expect(addedEdge!.id).toBe("e_new");
    });

    it("應偵測移除連線", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.edges = [];

      const result = semanticDiff(before, after);
      const removedEdge = result.changes.find(
        (c) => c.category === "edge" && c.type === "removed"
      );

      expect(removedEdge).toBeDefined();
    });
  });

  describe("統計", () => {
    it("stats 應正確計算", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.nodes[0].label = "Changed";
      after.edges.push({
        id: "e_new",
        sourceNodeId: "trigger_1",
        sourcePortId: "extra",
        targetNodeId: "response_1",
        targetPortId: "extra",
      });

      const result = semanticDiff(before, after);

      expect(result.stats.modified).toBeGreaterThanOrEqual(1);
      expect(result.stats.added).toBeGreaterThanOrEqual(1);
      expect(result.stats.total).toBe(
        result.stats.added + result.stats.removed + result.stats.modified
      );
    });
  });

  describe("formatDiff", () => {
    it("無差異時應顯示 ✅ 無差異", () => {
      const ir = createSimpleGetFlow();
      const result = semanticDiff(ir, ir);
      const output = formatDiff(result);

      expect(output).toContain("✅ 無差異");
    });

    it("有差異時應顯示摘要統計", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.nodes[0].label = "Modified";

      const result = semanticDiff(before, after);
      const output = formatDiff(result);

      expect(output).toContain("📊 差異摘要");
      expect(output).toContain("Nodes");
    });

    it("格式化應包含詳細的欄位差異", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.meta.name = "New Name";

      const result = semanticDiff(before, after);
      const output = formatDiff(result);

      expect(output).toContain("Meta");
      expect(output).toContain("meta.name");
    });
  });
});
