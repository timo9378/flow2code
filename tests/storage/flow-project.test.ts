/**
 * FlowProject (Git-Native Split Storage) 測試
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadFlowProject,
  saveFlowProject,
  detectFormat,
  migrateToSplit,
} from "@/lib/storage/flow-project";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";

const TMP = join(tmpdir(), `flow2code-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) {
    rmSync(TMP, { recursive: true, force: true });
  }
});

describe("detectFormat", () => {
  it("should detect .flow.json as json format", () => {
    const jsonPath = join(TMP, "test.flow.json");
    writeFileSync(jsonPath, "{}");
    const { format } = detectFormat(jsonPath);
    expect(format).toBe("json");
  });

  it("should detect directory with meta.yaml as split format", () => {
    const dir = join(TMP, "my-flow");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.yaml"), "version: 1.0.0\nname: test");
    const { format } = detectFormat(dir);
    expect(format).toBe("split");
  });

  it("should fall back to split for nonexistent paths", () => {
    const { format } = detectFormat(join(TMP, "nonexistent"));
    expect(format).toBe("split");
  });

  it("should detect json by adding .flow.json suffix", () => {
    const basePath = join(TMP, "myflow");
    writeFileSync(`${basePath}.flow.json`, "{}");
    const { resolvedPath, format } = detectFormat(basePath);
    expect(format).toBe("json");
    expect(resolvedPath).toBe(`${basePath}.flow.json`);
  });
});

describe("saveFlowProject", () => {
  it("should save as split YAML directory by default", () => {
    const ir = createSimpleGetFlow();
    const dir = join(TMP, "save-test");
    const written = saveFlowProject(ir, dir);

    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "meta.yaml"))).toBe(true);
    expect(existsSync(join(dir, "edges.yaml"))).toBe(true);
    expect(existsSync(join(dir, "nodes"))).toBe(true);
  });

  it("should save as JSON when format is json", () => {
    const ir = createSimpleGetFlow();
    const path = join(TMP, "save-test.flow.json");
    const written = saveFlowProject(ir, path, { format: "json" });

    expect(written.length).toBe(1);
    expect(existsSync(path)).toBe(true);
    const saved = JSON.parse(readFileSync(path, "utf-8"));
    expect(saved.meta.name).toBe("Simple GET");
  });

  it("should clean orphan node files by default", () => {
    const ir = createPostWithFetchFlow();
    const dir = join(TMP, "orphan-test");

    // 先儲存完整 IR
    saveFlowProject(ir, dir);
    const nodesBefore = readdirSync(join(dir, "nodes"));

    // 移除一個節點後重新儲存
    const reduced = { ...ir, nodes: ir.nodes.slice(0, 1) };
    saveFlowProject(reduced, dir);
    const nodesAfter = readdirSync(join(dir, "nodes"));

    expect(nodesAfter.length).toBeLessThan(nodesBefore.length);
  });
});

describe("loadFlowProject", () => {
  it("should load from split YAML directory", () => {
    const ir = createSimpleGetFlow();
    const dir = join(TMP, "load-split");
    saveFlowProject(ir, dir);

    const loaded = loadFlowProject(dir);
    expect(loaded.format).toBe("split");
    expect(loaded.ir.meta.name).toBe("Simple GET");
    expect(loaded.ir.nodes.length).toBe(ir.nodes.length);
    expect(loaded.ir.edges.length).toBe(ir.edges.length);
  });

  it("should load from .flow.json file", () => {
    const ir = createSimpleGetFlow();
    const path = join(TMP, "load-json.flow.json");
    writeFileSync(path, JSON.stringify(ir));

    const loaded = loadFlowProject(path);
    expect(loaded.format).toBe("json");
    expect(loaded.ir.meta.name).toBe("Simple GET");
  });

  it("should auto-detect .flow.json by path without extension", () => {
    const ir = createSimpleGetFlow();
    const basePath = join(TMP, "autodetect");
    writeFileSync(`${basePath}.flow.json`, JSON.stringify(ir));

    const loaded = loadFlowProject(basePath);
    expect(loaded.format).toBe("json");
  });

  it("should throw for nonexistent path", () => {
    expect(() => loadFlowProject(join(TMP, "nonexistent"))).toThrow();
  });

  it("should round-trip: save → load preserves IR", () => {
    const ir = createPostWithFetchFlow();
    const dir = join(TMP, "roundtrip");
    saveFlowProject(ir, dir);

    const loaded = loadFlowProject(dir);
    expect(loaded.ir.nodes.length).toBe(ir.nodes.length);
    expect(loaded.ir.edges.length).toBe(ir.edges.length);
    expect(loaded.ir.meta.name).toBe(ir.meta.name);
    
    // 每個節點的資料應一致
    for (const node of ir.nodes) {
      const loadedNode = loaded.ir.nodes.find((n) => n.id === node.id);
      expect(loadedNode).toBeDefined();
      expect(loadedNode!.nodeType).toBe(node.nodeType);
      expect(loadedNode!.label).toBe(node.label);
    }
  });
});

describe("migrateToSplit", () => {
  it("should migrate .flow.json to YAML directory", () => {
    const ir = createSimpleGetFlow();
    const jsonPath = join(TMP, "migrate.flow.json");
    writeFileSync(jsonPath, JSON.stringify(ir));

    const written = migrateToSplit(jsonPath);
    expect(written.length).toBeGreaterThan(0);

    // 原 json 仍應存在
    expect(existsSync(jsonPath)).toBe(true);

    // YAML 目錄應已建立
    const dirPath = join(TMP, "migrate");
    expect(existsSync(join(dirPath, "meta.yaml"))).toBe(true);
  });

  it("should throw for nonexistent file", () => {
    expect(() => migrateToSplit(join(TMP, "nope.flow.json"))).toThrow();
  });
});
