/**
 * Type Inference 測試
 *
 * 驗證 flowState 的型別推斷正確性。
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { inferFlowStateTypes } from "@/lib/compiler/type-inference";
import { registerPlugins } from "@/lib/compiler/plugins/types";
import { builtinPlugins } from "@/lib/compiler/plugins/builtin";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";
import type { FlowIR } from "@/lib/ir/types";
import { NodeCategory, TriggerType, ActionType, OutputType } from "@/lib/ir/types";

// 確保 plugins 已註冊
registerPlugins(builtinPlugins);

describe("Type Inference", () => {
  it("應生成 FlowState interface", () => {
    const result = compile(createSimpleGetFlow());

    expect(result.success).toBe(true);
    expect(result.code).toContain("interface FlowState");
    expect(result.code).toContain("const flowState: Partial<FlowState> = {}");
  });

  it("不應包含 Record<string, any>", () => {
    const result = compile(createSimpleGetFlow());

    expect(result.code).not.toContain("Record<string, any>");
  });

  it("GET 觸發器應推斷為 { query, url } 型別", () => {
    const result = compile(createSimpleGetFlow());

    expect(result.code).toContain("query: Record<string, string>");
    expect(result.code).toContain("url: string");
  });

  it("POST 觸發器應推斷包含 body 型別", () => {
    const result = compile(createPostWithFetchFlow());

    expect(result.code).toContain("body: unknown");
    expect(result.code).toContain("url: string");
  });

  it("Fetch API 節點 parseJson=true 應推斷為 unknown", () => {
    const ir = createPostWithFetchFlow();
    const typeInfo = inferFlowStateTypes(ir);

    // fetch_1 is parseJson: true → Envelope type
    expect(typeInfo.nodeTypes.get("fetch_1")).toBe(
      "{ data: unknown; status: number; headers: Record<string, string> }"
    );
  });

  it("Return Response 節點應推斷為 never", () => {
    const ir = createSimpleGetFlow();
    const typeInfo = inferFlowStateTypes(ir);

    expect(typeInfo.nodeTypes.get("response_1")).toBe("never");
  });

  it("Redis Cache get 應推斷為 string | null", () => {
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
});
