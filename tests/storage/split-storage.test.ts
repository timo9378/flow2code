/**
 * Split Storage Tests
 * 
 * Tests bidirectional conversion between FlowIR ↔ YAML directory structure
 */

import { describe, it, expect } from "vitest";
import { splitIR, mergeIR, type SplitFiles } from "@/lib/storage/split-storage";
import { createSimpleGetFlow, createPostWithFetchFlow, createConcurrentFlow } from "../fixtures";

describe("splitIR", () => {
  it("should split a simple flow into correct file structure", () => {
    const ir = createSimpleGetFlow();
    const files = splitIR(ir);

    // meta.yaml should contain version and name
    expect(files.meta).toContain("version:");
    expect(files.meta).toContain("Simple GET");
    expect(files.meta).toContain("nodeOrder:");

    // edges.yaml should contain connections
    expect(files.edges).toContain("trigger_1:request");
    expect(files.edges).toContain("response_1:data");

    // Should have 2 node files
    expect(files.nodes.size).toBe(2);
    expect(files.nodes.has("trigger_1.yaml")).toBe(true);
    expect(files.nodes.has("response_1.yaml")).toBe(true);
  });

  it("should include node params in YAML", () => {
    const ir = createSimpleGetFlow();
    const files = splitIR(ir);

    const triggerYaml = files.nodes.get("trigger_1.yaml")!;
    expect(triggerYaml).toContain("http_webhook");
    expect(triggerYaml).toContain("/api/hello");
    expect(triggerYaml).toContain("method: GET");
  });

  it("should handle flows with multiple nodes", () => {
    const ir = createConcurrentFlow();
    const files = splitIR(ir);

    expect(files.nodes.size).toBe(4); // trigger + 2 fetches + response
  });
});

describe("mergeIR", () => {
  it("should round-trip: splitIR → mergeIR preserves data", () => {
    const original = createSimpleGetFlow();
    const files = splitIR(original);
    const restored = mergeIR(files);

    expect(restored.version).toBe(original.version);
    expect(restored.meta.name).toBe(original.meta.name);
    expect(restored.nodes.length).toBe(original.nodes.length);
    expect(restored.edges.length).toBe(original.edges.length);

    // Check node content
    expect(restored.nodes[0].id).toBe(original.nodes[0].id);
    expect(restored.nodes[0].nodeType).toBe(original.nodes[0].nodeType);
    expect(restored.nodes[0].params).toEqual(original.nodes[0].params);
  });

  it("should preserve node order from meta.yaml", () => {
    const original = createPostWithFetchFlow();
    const files = splitIR(original);
    const restored = mergeIR(files);

    // Node order should be the same as original
    expect(restored.nodes.map((n) => n.id)).toEqual(
      original.nodes.map((n) => n.id)
    );
  });

  it("should reconstruct edges from compact format", () => {
    const original = createPostWithFetchFlow();
    const files = splitIR(original);
    const restored = mergeIR(files);

    expect(restored.edges.length).toBe(original.edges.length);
    expect(restored.edges[0].sourceNodeId).toBe("trigger_1");
    expect(restored.edges[0].sourcePortId).toBe("request");
    expect(restored.edges[0].targetNodeId).toBe("fetch_1");
    expect(restored.edges[0].targetPortId).toBe("input");
  });

  it("should round-trip complex concurrent flow", () => {
    const original = createConcurrentFlow();
    const files = splitIR(original);
    const restored = mergeIR(files);

    expect(restored.nodes.length).toBe(original.nodes.length);
    expect(restored.edges.length).toBe(original.edges.length);
    
    // All node params should be equal
    for (let i = 0; i < original.nodes.length; i++) {
      expect(restored.nodes[i].params).toEqual(original.nodes[i].params);
    }
  });
});

describe("YAML format quality", () => {
  it("should produce human-readable YAML with headers", () => {
    const ir = createSimpleGetFlow();
    const files = splitIR(ir);

    expect(files.meta).toMatch(/^# Flow2Code Meta/);
    expect(files.edges).toMatch(/^# Flow2Code Edges/);
    
    for (const [, yaml] of files.nodes) {
      expect(yaml).toMatch(/^# Node:/);
    }
  });

  it("edge format should be compact sourceNodeId:portId notation", () => {
    const ir = createSimpleGetFlow();
    const files = splitIR(ir);

    // Should not contain expanded sourceNodeId/targetNodeId fields
    // Instead use source: "trigger_1:request" format
    expect(files.edges).toContain("source:");
    expect(files.edges).toContain("target:");
  });
});
