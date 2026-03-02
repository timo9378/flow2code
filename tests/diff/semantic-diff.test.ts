/**
 * Semantic Diff Engine Tests
 *
 * Verifies: node diffs, edge diffs, meta diffs, formatted output.
 */

import { describe, it, expect } from "vitest";
import { semanticDiff, formatDiff } from "@/lib/diff/semantic-diff";
import type { FlowIR } from "@/lib/ir/types";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";

describe("Semantic Diff Engine", () => {
  describe("No Differences", () => {
    it("identical IR should return zero differences", () => {
      const ir = createSimpleGetFlow();
      const result = semanticDiff(ir, ir);

      expect(result.stats.total).toBe(0);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe("Meta Differences", () => {
    it("should detect name changes", () => {
      const before = createSimpleGetFlow();
      const after = { ...createSimpleGetFlow(), meta: { ...before.meta, name: "Updated Name" } };

      const result = semanticDiff(before, after);
      const metaChange = result.changes.find(c => c.category === "meta");

      expect(metaChange).toBeDefined();
      expect(metaChange!.type).toBe("modified");
      expect(metaChange!.description).toContain("meta.name");
    });
  });

  describe("Node Differences", () => {
    it("should detect added nodes", () => {
      const before = createSimpleGetFlow();
      const after = createPostWithFetchFlow(); // has additional fetch_1 node

      const result = semanticDiff(before, after);
      const addedNodes = result.changes.filter(
        (c) => c.category === "node" && c.type === "added"
      );

      expect(addedNodes.length).toBeGreaterThan(0);
    });

    it("should detect removed nodes", () => {
      const before = createPostWithFetchFlow();
      const after = createSimpleGetFlow();

      const result = semanticDiff(before, after);
      const removedNodes = result.changes.filter(
        (c) => c.category === "node" && c.type === "removed"
      );

      expect(removedNodes.length).toBeGreaterThan(0);
    });

    it("should detect modified nodes (label change)", () => {
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

    it("should detect node parameter changes", () => {
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

  describe("Edge Differences", () => {
    it("should detect added edges", () => {
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

    it("should detect removed edges", () => {
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

  describe("Statistics", () => {
    it("stats should calculate correctly", () => {
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
    it("should display ✅ No Differences when there are none", () => {
      const ir = createSimpleGetFlow();
      const result = semanticDiff(ir, ir);
      const output = formatDiff(result);

      expect(output).toContain("✅ No differences");
    });

    it("should display summary statistics when there are differences", () => {
      const before = createSimpleGetFlow();
      const after = JSON.parse(JSON.stringify(before)) as FlowIR;
      after.nodes[0].label = "Modified";

      const result = semanticDiff(before, after);
      const output = formatDiff(result);

      expect(output).toContain("📊 Diff summary");
      expect(output).toContain("Nodes");
    });

    it("format should include detailed field differences", () => {
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
