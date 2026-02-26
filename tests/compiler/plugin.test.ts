/**
 * Plugin System 測試
 *
 * 驗證自定義 Plugin 的註冊與覆蓋機制。
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { registerPlugin, getPlugin, clearPlugins, createPluginRegistry } from "@/lib/compiler/plugins/types";
import { builtinPlugins } from "@/lib/compiler/plugins/builtin";
import { createSimpleGetFlow } from "../fixtures";
import type { FlowIR } from "@/lib/ir/types";
import { NodeCategory, TriggerType, OutputType } from "@/lib/ir/types";

describe("Plugin System", () => {
  it("所有內建節點類型應有對應 Plugin", () => {
    // 使用 per-instance registry 驗證所有內建 plugin
    const registry = createPluginRegistry();
    registry.registerAll(builtinPlugins);

    const expectedTypes = [
      "http_webhook",
      "cron_job",
      "manual",
      "fetch_api",
      "sql_query",
      "redis_cache",
      "custom_code",
      "if_else",
      "for_loop",
      "try_catch",
      "promise_all",
      "declare",
      "transform",
      "return_response",
    ];

    for (const nodeType of expectedTypes) {
      expect(registry.get(nodeType)).toBeDefined();
    }
  });

  it("自定義 Plugin 應可透過 compile options 注入", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/test",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "custom_1",
          nodeType: "aws_ses_email" as any,
          category: NodeCategory.ACTION,
          label: "Send Email",
          params: {},
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{ sent: true }" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "custom_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "custom_1", sourcePortId: "result", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir, {
      plugins: [
        {
          nodeType: "aws_ses_email",
          generate(node, writer) {
            writer.writeLine(`// AWS SES Email Plugin`);
            writer.writeLine(`const emailResult = await ses.sendEmail({ to: "user@example.com" });`);
            writer.writeLine(`flowState['${node.id}'] = emailResult;`);
          },
          getRequiredPackages: () => ["@aws-sdk/client-ses"],
          getOutputType: () => "{ messageId: string }",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.code).toContain("AWS SES Email Plugin");
    expect(result.code).toContain("ses.sendEmail");
    expect(result.dependencies!.all).toContain("@aws-sdk/client-ses");
  });

  it("自定義 Plugin 應可覆蓋內建 Plugin", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/test",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{ custom: true }" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    // 先用原版
    const original = compile(ir);
    expect(original.code).toContain("NextResponse.json");

    // 用覆蓋版 — 自定義的 return_response
    const overridden = compile(ir, {
      plugins: [
        {
          nodeType: "return_response",
          generate(node, writer) {
            writer.writeLine(`return new Response(JSON.stringify({ custom: true }), { status: 200 });`);
          },
        },
      ],
    });

    expect(overridden.success).toBe(true);
    expect(overridden.code).toContain("new Response(JSON.stringify");
  });
});
