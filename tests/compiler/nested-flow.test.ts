/**
 * Phase 2 Tests: Nested Control Flow Composite Scenarios
 *
 * Verifies complex combinations such as if_else nested with for_loop, try_catch nested with if_else, etc.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";
import { NodeCategory, TriggerType, ActionType, LogicType, OutputType } from "@/lib/ir/types";

function wrapIR(name: string, nodes: any[], edges: any[]): FlowIR {
  return {
    version: "1.0.0",
    meta: { name, createdAt: "", updatedAt: "" },
    nodes,
    edges,
  };
}

// ============================================================
// If/Else Nested with For Loop
// ============================================================

describe("Nested Control Flow", () => {
  it("If/Else nested with For Loop should generate correct nested structure", () => {
    const ir = wrapIR("if-for-nested", [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/batch",
        params: { method: "POST", routePath: "/api/batch", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Check Array",
        params: { condition: "Array.isArray(flowState['trigger_1']?.body)" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "loop_1",
        nodeType: LogicType.FOR_LOOP,
        category: NodeCategory.LOGIC,
        label: "Process Each",
        params: {
          iterableExpression: "flowState['trigger_1'].body",
          itemVariable: "item",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "body", label: "Body", dataType: "any" },
          { id: "done", label: "Done", dataType: "any" },
        ],
      },
      {
        id: "response_ok",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Success",
        params: { statusCode: 200, bodyExpression: '{ processed: true }' },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
      {
        id: "response_err",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Bad Request",
        params: { statusCode: 400, bodyExpression: '{ error: "Expected array" }' },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ], [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "loop_1", targetPortId: "input" },
      { id: "e3", sourceNodeId: "if_1", sourcePortId: "false", targetNodeId: "response_err", targetPortId: "data" },
      { id: "e4", sourceNodeId: "loop_1", sourcePortId: "done", targetNodeId: "response_ok", targetPortId: "data" },
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    const code = result.code!;

    // Should have if structure
    expect(code).toContain("if (");
    // Should have for loop
    expect(code).toContain("for (const item of");
    // Should have else branch
    expect(code).toContain("else {");
    // Two different Responses
    expect(code).toContain("200");
    expect(code).toContain("400");
  });

  it("Try/Catch nested with If/Else should generate correctly", () => {
    const ir = wrapIR("try-if-nested", [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/safe",
        params: { method: "POST", routePath: "/api/safe", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "tc_1",
        nodeType: LogicType.TRY_CATCH,
        category: NodeCategory.LOGIC,
        label: "Safe Wrapper",
        params: { errorVariable: "err" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "success", label: "Success", dataType: "any" },
          { id: "error", label: "Error", dataType: "any" },
        ],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Validate",
        params: { condition: "flowState['trigger_1']?.body?.valid === true" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "code_ok",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Valid Code",
        params: { code: 'const ok = "valid";', returnVariable: "ok" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      {
        id: "code_err_handler",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Error Handler",
        params: { code: 'console.error("Caught:", err);' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Final Response",
        params: { statusCode: 200, bodyExpression: '{ done: true }' },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ], [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "tc_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "tc_1", sourcePortId: "success", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e3", sourceNodeId: "tc_1", sourcePortId: "error", targetNodeId: "code_err_handler", targetPortId: "input" },
      { id: "e4", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "code_ok", targetPortId: "input" },
      { id: "e5", sourceNodeId: "tc_1", sourcePortId: "success", targetNodeId: "response_1", targetPortId: "data", },
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    const code = result.code!;

    // Nested structure verification
    expect(code).toContain("try {");
    expect(code).toContain("catch (err)");
    expect(code).toContain("if (");
    expect(code).toContain("success: true");
    expect(code).toContain("success: false");
  });

  it("Cross-platform composite scenario: Express + If/Else + ForLoop", () => {
    const ir = wrapIR("express-nested", [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/process",
        params: { method: "POST", routePath: "/api/process", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Has Items",
        params: { condition: "flowState['trigger_1']?.body?.items?.length > 0" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "response_ok",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "OK",
        params: { statusCode: 200, bodyExpression: '{ result: "done" }' },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
      {
        id: "response_empty",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Empty",
        params: { statusCode: 200, bodyExpression: '{ result: "empty" }' },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ], [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "response_ok", targetPortId: "data" },
      { id: "e3", sourceNodeId: "if_1", sourcePortId: "false", targetNodeId: "response_empty", targetPortId: "data" },
    ]);

    const result = compile(ir, { platform: "express" });
    expect(result.success).toBe(true);
    const code = result.code!;

    // Express-specific: req.body / res.status().json()
    expect(code).toContain("req.body");
    expect(code).toContain("res.status(200).json");
    // Should not have NextResponse
    expect(code).not.toContain("NextResponse");
    // Control flow structure
    expect(code).toContain("if (");
    expect(code).toContain("else {");
  });
});
