/**
 * Dynamic Node Registry 測試
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NodeRegistry, nodeRegistry, type NodeDefinition } from "@/lib/node-registry";
import { NodeCategory, TriggerType, ActionType, LogicType, VariableType, OutputType } from "@/lib/ir/types";

describe("NodeRegistry", () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  const sampleDef: NodeDefinition = {
    nodeType: "action:s3_upload",
    category: NodeCategory.ACTION,
    label: "S3 Upload",
    icon: "☁️",
    description: "Upload to AWS S3",
    defaultPorts: {
      inputs: [{ id: "file", label: "File", dataType: "object", required: true }],
      outputs: [{ id: "url", label: "URL", dataType: "string" }],
    },
    defaultParams: { bucket: "my-bucket", region: "us-east-1" },
  };

  it("should register and retrieve a node definition", () => {
    registry.register(sampleDef);

    const def = registry.get("action:s3_upload");
    expect(def).toBeDefined();
    expect(def!.label).toBe("S3 Upload");
    expect(def!.icon).toBe("☁️");
  });

  it("should report has() correctly", () => {
    expect(registry.has("action:s3_upload")).toBe(false);
    registry.register(sampleDef);
    expect(registry.has("action:s3_upload")).toBe(true);
  });

  it("should unregister a node", () => {
    registry.register(sampleDef);
    expect(registry.unregister("action:s3_upload")).toBe(true);
    expect(registry.has("action:s3_upload")).toBe(false);
  });

  it("should batch register with registerAll", () => {
    const defs: NodeDefinition[] = [
      sampleDef,
      { ...sampleDef, nodeType: "action:s3_download", label: "S3 Download" },
    ];
    registry.registerAll(defs);
    expect(registry.getAll().length).toBe(2);
  });

  it("should filter by category", () => {
    registry.registerAll([
      sampleDef,
      {
        nodeType: "trigger:mqtt",
        category: NodeCategory.TRIGGER,
        label: "MQTT",
        icon: "📡",
        defaultPorts: { inputs: [], outputs: [{ id: "msg", label: "Message", dataType: "object" }] },
        defaultParams: { topic: "test/#" },
      },
    ]);

    const actions = registry.getByCategory(NodeCategory.ACTION);
    expect(actions.length).toBe(1);
    expect(actions[0].nodeType).toBe("action:s3_upload");

    const triggers = registry.getByCategory(NodeCategory.TRIGGER);
    expect(triggers.length).toBe(1);
  });

  it("should clear all definitions", () => {
    registry.register(sampleDef);
    registry.clear();
    expect(registry.getAll().length).toBe(0);
  });

  // ── 向下相容 API ──

  it("getDefaultPorts should return registered ports", () => {
    registry.register(sampleDef);
    const ports = registry.getDefaultPorts("action:s3_upload");
    expect(ports.inputs.length).toBe(1);
    expect(ports.outputs[0].dataType).toBe("string");
  });

  it("getDefaultParams should return registered params", () => {
    registry.register(sampleDef);
    const params = registry.getDefaultParams("action:s3_upload");
    expect(params).toEqual({ bucket: "my-bucket", region: "us-east-1" });
  });

  it("getDefaultLabel should return registered label", () => {
    registry.register(sampleDef);
    expect(registry.getDefaultLabel("action:s3_upload")).toBe("S3 Upload");
  });

  it("getCategoryForType should return registered category", () => {
    registry.register(sampleDef);
    expect(registry.getCategoryForType("action:s3_upload")).toBe(NodeCategory.ACTION);
  });

  it("should fallback to empty/default for unknown types", () => {
    const ports = registry.getDefaultPorts("unknown:type");
    expect(ports).toEqual({ inputs: [], outputs: [] });
    expect(registry.getDefaultLabel("unknown:type")).toBe("Unknown");
    expect(registry.getCategoryForType("unknown:type")).toBe(NodeCategory.ACTION);
  });

  // ── Grouped definitions ──

  it("getGroupedDefinitions should organize into groups", () => {
    registry.registerAll([
      { ...sampleDef, order: 10 },
      {
        nodeType: "trigger:mqtt",
        category: NodeCategory.TRIGGER,
        label: "MQTT",
        icon: "📡",
        defaultPorts: { inputs: [], outputs: [] },
        defaultParams: {},
        order: 1,
      },
    ]);

    const groups = registry.getGroupedDefinitions();
    expect(Object.keys(groups)).toContain("觸發器");
    expect(Object.keys(groups)).toContain("執行器");
    expect(groups["觸發器"].templates[0].nodeType).toBe("trigger:mqtt");
  });
});

describe("Global nodeRegistry (builtins)", () => {
  it("should have all 15 built-in node types registered", () => {
    const all = nodeRegistry.getAll();
    expect(all.length).toBe(15);
  });

  it("should include all TriggerTypes", () => {
    expect(nodeRegistry.has(TriggerType.HTTP_WEBHOOK)).toBe(true);
    expect(nodeRegistry.has(TriggerType.CRON_JOB)).toBe(true);
    expect(nodeRegistry.has(TriggerType.MANUAL)).toBe(true);
  });

  it("should include all ActionTypes", () => {
    expect(nodeRegistry.has(ActionType.FETCH_API)).toBe(true);
    expect(nodeRegistry.has(ActionType.SQL_QUERY)).toBe(true);
    expect(nodeRegistry.has(ActionType.REDIS_CACHE)).toBe(true);
    expect(nodeRegistry.has(ActionType.CUSTOM_CODE)).toBe(true);
    expect(nodeRegistry.has(ActionType.CALL_SUBFLOW)).toBe(true);
  });

  it("should include all LogicTypes", () => {
    expect(nodeRegistry.has(LogicType.IF_ELSE)).toBe(true);
    expect(nodeRegistry.has(LogicType.FOR_LOOP)).toBe(true);
    expect(nodeRegistry.has(LogicType.TRY_CATCH)).toBe(true);
    expect(nodeRegistry.has(LogicType.PROMISE_ALL)).toBe(true);
  });

  it("should include all VariableTypes and OutputTypes", () => {
    expect(nodeRegistry.has(VariableType.DECLARE)).toBe(true);
    expect(nodeRegistry.has(VariableType.TRANSFORM)).toBe(true);
    expect(nodeRegistry.has(OutputType.RETURN_RESPONSE)).toBe(true);
  });

  it("getDefaultPorts should match legacy values for HTTP webhook", () => {
    const ports = nodeRegistry.getDefaultPorts(TriggerType.HTTP_WEBHOOK);
    expect(ports.inputs).toEqual([]);
    expect(ports.outputs.length).toBe(3);
    expect(ports.outputs[0].id).toBe("request");
  });

  it("getDefaultParams should match legacy values for FETCH_API", () => {
    const params = nodeRegistry.getDefaultParams(ActionType.FETCH_API);
    expect(params).toEqual({ url: "https://api.example.com", method: "GET", parseJson: true });
  });

  it("getCategoryForType should work for all builtins", () => {
    expect(nodeRegistry.getCategoryForType(TriggerType.HTTP_WEBHOOK)).toBe(NodeCategory.TRIGGER);
    expect(nodeRegistry.getCategoryForType(ActionType.FETCH_API)).toBe(NodeCategory.ACTION);
    expect(nodeRegistry.getCategoryForType(LogicType.IF_ELSE)).toBe(NodeCategory.LOGIC);
    expect(nodeRegistry.getCategoryForType(VariableType.DECLARE)).toBe(NodeCategory.VARIABLE);
    expect(nodeRegistry.getCategoryForType(OutputType.RETURN_RESPONSE)).toBe(NodeCategory.OUTPUT);
  });
});
