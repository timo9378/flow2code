/**
 * Split Storage 測試
 * 
 * 測試 FlowIR ↔ YAML 目錄結構的雙向轉換
 */

import { describe, it, expect } from "vitest";
import { splitIR, mergeIR, type SplitFiles } from "@/lib/storage/split-storage";
import { createSimpleGetFlow, createPostWithFetchFlow, createConcurrentFlow } from "../fixtures";

describe("splitIR", () => {
  it("should split a simple flow into correct file structure", () => {
    const ir = createSimpleGetFlow();
    const files = splitIR(ir);

    // meta.yaml 應包含版本和名稱
    expect(files.meta).toContain("version:");
    expect(files.meta).toContain("Simple GET");
    expect(files.meta).toContain("nodeOrder:");

    // edges.yaml 應包含連線
    expect(files.edges).toContain("trigger_1:request");
    expect(files.edges).toContain("response_1:data");

    // 應有 2 個節點檔案
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

    // 檢查節點內容
    expect(restored.nodes[0].id).toBe(original.nodes[0].id);
    expect(restored.nodes[0].nodeType).toBe(original.nodes[0].nodeType);
    expect(restored.nodes[0].params).toEqual(original.nodes[0].params);
  });

  it("should preserve node order from meta.yaml", () => {
    const original = createPostWithFetchFlow();
    const files = splitIR(original);
    const restored = mergeIR(files);

    // 節點順序應與原始相同
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
    
    // 所有節點 params 應相等
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

    // 不應包含展開的 sourceNodeId/targetNodeId 字段
    // 而是使用 source: "trigger_1:request" 格式
    expect(files.edges).toContain("source:");
    expect(files.edges).toContain("target:");
  });
});
