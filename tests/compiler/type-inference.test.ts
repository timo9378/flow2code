/**
 * Type Inference Tests
 *
 * Verifies the correctness of flowState type inference.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { inferFlowStateTypes } from "@/lib/compiler/type-inference";
import { registerPlugins } from "@/lib/compiler/plugins/types";
import { builtinPlugins } from "@/lib/compiler/plugins/builtin";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";
import type { FlowIR } from "@/lib/ir/types";
import { NodeCategory, TriggerType, ActionType, OutputType } from "@/lib/ir/types";

// Ensure plugins are registered
registerPlugins(builtinPlugins);

describe("Type Inference", () => {
  it("should generate FlowState interface", () => {
    const result = compile(createSimpleGetFlow());

    expect(result.success).toBe(true);
    expect(result.code).toContain("interface FlowState");
    expect(result.code).toContain("const flowState: Partial<FlowState> = {}");
  });

  it("should not contain Record<string, any>", () => {
    const result = compile(createSimpleGetFlow());

    expect(result.code).not.toContain("Record<string, any>");
  });

  it("GET trigger should infer { query, url } type", () => {
    const result = compile(createSimpleGetFlow());

    expect(result.code).toContain("query: Record<string, string>");
    expect(result.code).toContain("url: string");
  });

  it("POST trigger should infer a type containing body", () => {
    const result = compile(createPostWithFetchFlow());

    expect(result.code).toContain("body: unknown");
    expect(result.code).toContain("url: string");
  });

  it("Fetch API node with parseJson=true should infer as unknown", () => {
    const ir = createPostWithFetchFlow();
    const typeInfo = inferFlowStateTypes(ir);

    // fetch_1 is parseJson: true → Envelope type
    expect(typeInfo.nodeTypes.get("fetch_1")).toBe(
      "{ data: unknown; status: number; headers: Record<string, string> }"
    );
  });

  it("Return Response node should infer as never", () => {
    const ir = createSimpleGetFlow();
    const typeInfo = inferFlowStateTypes(ir);

    expect(typeInfo.nodeTypes.get("response_1")).toBe("never");
  });

  it("Redis Cache get should infer as string | null", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/cache",
          params: { method: "GET", routePath: "/api/cache", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "redis_1",
          nodeType: ActionType.REDIS_CACHE,
          category: NodeCategory.ACTION,
          label: "Get Cache",
          params: { operation: "get", key: "test_key" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "value", label: "Value", dataType: "any" }],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "redis_1", targetPortId: "input" },
      ],
    };

    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("redis_1")).toBe("string | null");
  });

  // ── P2-4 Added: transform / custom_code / call_subflow ──

  it("Transform .map() should infer as unknown[]", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "transform_1",
          nodeType: "transform" as any,
          category: NodeCategory.VARIABLE,
          label: "Map",
          params: { expression: "items.map(i => i.name)" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
          outputs: [{ id: "output", label: "Output", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("transform_1")).toBe("unknown[]");
  });

  it("Transform .length should infer as number", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "transform_1",
          nodeType: "transform" as any,
          category: NodeCategory.VARIABLE,
          label: "Count",
          params: { expression: "arr.length" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
          outputs: [{ id: "output", label: "Output", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("transform_1")).toBe("number");
  });

  it("Transform JSON.stringify should infer as string", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "transform_1",
          nodeType: "transform" as any,
          category: NodeCategory.VARIABLE,
          label: "Stringify",
          params: { expression: "JSON.stringify(data)" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
          outputs: [{ id: "output", label: "Output", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("transform_1")).toBe("string");
  });

  it("Transform Object.keys should infer as string[]", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "transform_1",
          nodeType: "transform" as any,
          category: NodeCategory.VARIABLE,
          label: "Keys",
          params: { expression: "Object.keys(obj)" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
          outputs: [{ id: "output", label: "Output", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("transform_1")).toBe("string[]");
  });

  it("Custom Code without returnVariable should infer as void", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "custom_1",
          nodeType: ActionType.CUSTOM_CODE,
          category: NodeCategory.ACTION,
          label: "Log",
          params: { code: "console.log('hello');" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("custom_1")).toBe("void");
  });

  it("Custom Code with returnType should use specified type", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "custom_1",
          nodeType: ActionType.CUSTOM_CODE,
          category: NodeCategory.ACTION,
          label: "Custom",
          params: { code: "const x = 1;", returnVariable: "x", returnType: "number" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("custom_1")).toBe("number");
  });

  it("Call Subflow should infer as Awaited<ReturnType<typeof fn>>", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "subflow_1",
          nodeType: ActionType.CALL_SUBFLOW,
          category: NodeCategory.ACTION,
          label: "Auth",
          params: { flowPath: "./auth", functionName: "checkAuth", inputMapping: {} },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("subflow_1")).toBe("Awaited<ReturnType<typeof checkAuth>>");
  });

  it("Call Subflow with returnType should use specified type", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "query", label: "Query", dataType: "object" }],
        },
        {
          id: "subflow_1",
          nodeType: ActionType.CALL_SUBFLOW,
          category: NodeCategory.ACTION,
          label: "Users",
          params: { flowPath: "./users", functionName: "getUsers", inputMapping: {}, returnType: "User[]" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "any" }],
        },
      ],
      edges: [],
    };
    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("subflow_1")).toBe("User[]");
  });
});
