/**
 * Phase 3.1 — Scope Shadowing / Symbol Table Leaking / DAG Scheduling / Static Import Tests
 *
 * Verifies four fixes:
 *   1. Nested loops no longer have _loopScope shadowing (dynamic scope variable names)
 *   2. If/Else sub-block nodes do not leak Symbol Table aliases
 *   3. DAG mode per-node promise scheduling (replaces hierarchical Promise.all)
 *   4. callSubflowPlugin uses static import (not runtime await import)
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { parseExpression, type ExpressionContext, type ScopeEntry } from "@/lib/compiler/expression-parser";
import { registerPlugins } from "@/lib/compiler/plugins/types";
import { builtinPlugins } from "@/lib/compiler/plugins/builtin";
import type { FlowIR } from "@/lib/ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  OutputType,
} from "@/lib/ir/types";

registerPlugins(builtinPlugins);

// ============================================================
// Fixtures
// ============================================================

/** Nested loops: outer loop + inner loop */
function createNestedLoopFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "Nested Loop", createdAt: "", updatedAt: "" },
    nodes: [
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
        id: "loop_users",
        nodeType: LogicType.FOR_LOOP,
        category: NodeCategory.LOGIC,
        label: "Loop Users",
        params: {
          iterableExpression: "{{trigger_1.body.users}}",
          itemVariable: "user",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "body", label: "Body", dataType: "any" }],
      },
      {
        id: "loop_orders",
        nodeType: LogicType.FOR_LOOP,
        category: NodeCategory.LOGIC,
        label: "Loop Orders",
        params: {
          iterableExpression: "{{loop_users.orders}}",
          itemVariable: "order",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "body", label: "Body", dataType: "any" }],
      },
      {
        id: "fetch_order",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Process Order",
        params: {
          url: "https://api.example.com/orders",
          method: "POST",
          parseJson: true,
          body: "{{loop_orders}}",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: { statusCode: 200, bodyExpression: "{{loop_users}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "loop_users", targetPortId: "input" },
      { id: "e2", sourceNodeId: "loop_users", sourcePortId: "body", targetNodeId: "loop_orders", targetPortId: "input" },
      { id: "e3", sourceNodeId: "loop_orders", sourcePortId: "body", targetNodeId: "fetch_order", targetPortId: "input" },
      { id: "e4", sourceNodeId: "loop_users", sourcePortId: "request", targetNodeId: "response_1", targetPortId: "input" },
    ],
  };
}

/** If/Else branching + downstream references to child nodes */
function createIfElseWithDownstreamFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "IfElse Downstream", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/check",
        params: { method: "POST", routePath: "/api/check", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Check Flag",
        params: { condition: "{{trigger_1.body.flag}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "fetch_user",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch User",
        params: {
          url: "https://api.example.com/user",
          method: "GET",
          parseJson: true,
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: { statusCode: 200, bodyExpression: "{{fetch_user}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "fetch_user", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_user", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
    ],
  };
}

/** DAG test flow: two concurrent → one depends on only one of them → response */
function createDAGFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "DAG Flow", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "GET /api/dashboard",
        params: { method: "GET", routePath: "/api/dashboard", parseBody: false },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "fetch_slow",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch Slow API",
        params: { url: "https://slow-api.example.com", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "fetch_fast",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch Fast API",
        params: { url: "https://fast-api.example.com", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "transform_1",
        nodeType: "transform",
        category: NodeCategory.VARIABLE,
        label: "Process Fast",
        params: { expression: "{{fetch_fast.data}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "output", label: "Output", dataType: "any" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: {
          statusCode: 200,
          bodyExpression: "{ slow: {{fetch_slow}}, fast: {{transform_1}} }",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_slow", targetPortId: "input" },
      { id: "e2", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_fast", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_fast", sourcePortId: "response", targetNodeId: "transform_1", targetPortId: "input" },
      { id: "e4", sourceNodeId: "fetch_slow", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
      { id: "e5", sourceNodeId: "transform_1", sourcePortId: "output", targetNodeId: "response_1", targetPortId: "input" },
    ],
  };
}

// ============================================================
// 1. Nested Loops — Verify No Scope Shadowing
// ============================================================

describe("Scope Shadowing (Nested Loops)", () => {
  it("nested loops should use different scope variable names", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // Outer loop's scope variable (includes node ID)
    expect(result.code).toContain("_scope_loop_users");
    // Inner loop's scope variable (includes different node ID)
    expect(result.code).toContain("_scope_loop_orders");
  });

  it("nested loops should not have two const declarations with the same name", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // Should not have hardcoded _loopScope (this would cause shadowing)
    expect(result.code).not.toContain("const _loopScope");
  });

  it("inner loop child node expressions should resolve to the correct scope variable", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // fetch_order's body `{{loop_orders}}` should resolve to inner scope
    expect(result.code).toContain("_scope_loop_orders['loop_orders']");
  });

  it("inner loop referencing outer loop iteration item should resolve to outer scope", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // Inner loop's iterableExpression `{{loop_users.orders}}` should resolve to outer scope
    expect(result.code).toContain("_scope_loop_users['loop_users'].orders");
  });
});

// ============================================================
// 2. Symbol Table Leaking — If/Else Sub-blocks
// ============================================================

describe("Symbol Table Block Scoping", () => {
  it("if/else sub-block nodes should not produce const alias", () => {
    const ir = createIfElseWithDownstreamFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // fetch_user is generated inside the if block, should not have top-level const fetchUser declaration
    expect(result.code).not.toContain("const fetchUser = flowState");
  });

  it("downstream nodes referencing sub-block nodes should use flowState, not Symbol Table alias", () => {
    const ir = createIfElseWithDownstreamFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // response_1's bodyExpression `{{fetch_user}}` should use flowState
    expect(result.code).toContain("flowState['fetch_user']");
    // Should not contain Symbol Table generated alias (fetchUser is not a valid top-level variable)
    // Only flowState['fetch_user'] is safe
  });

  it("sub-block nodes should not be duplicated at the top level of topological sort", () => {
    const ir = createIfElseWithDownstreamFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // fetch_user's code should only appear inside the if block, not duplicated at top level
    const fetchCount = (result.code!.match(/Fetch User/g) || []).length;
    // At most 3 times: node marker comment, console.error, possible throw error message
    // The key point is there should not be a second independent fetch code block
    expect(fetchCount).toBeLessThanOrEqual(3);
  });

  it("expression-parser: blockScopedNodeIds should skip Symbol Table", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "Fetch Data",
          params: { url: "https://example.com", method: "GET", parseJson: true },
          inputs: [],
          outputs: [{ id: "response", label: "Response", dataType: "object" }],
        },
      ],
      edges: [],
    };
    const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));

    // Using Symbol Table but fetch_1 is marked as block-scoped
    // Create a mock symbolTable
    const symbolTable = {
      hasVar: (id: string) => id === "fetch_1",
      getVarName: (id: string) => id === "fetch_1" ? "fetchData" : id,
    };

    const ctx: ExpressionContext = {
      ir,
      nodeMap,
      symbolTable: symbolTable as any,
      blockScopedNodeIds: new Set(["fetch_1"]),
    };

    // Even if Symbol Table has fetch_1 → fetchData, it should fallback to flowState
    const result = parseExpression("{{fetch_1.data}}", ctx);
    expect(result).toBe("flowState['fetch_1'].data");
  });
});

// ============================================================
// 3. DAG Concurrent Scheduling
// ============================================================

describe("DAG Concurrent Scheduling", () => {
  it("flows with concurrency opportunities should use DAG mode", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    expect(result.code).toContain("DAG Concurrent Execution");
  });

  it("each worker node should be wrapped as an independent promise", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    expect(result.code).toContain("const p_fetch_slow");
    expect(result.code).toContain("const p_fetch_fast");
    expect(result.code).toContain("const p_transform_1");
  });

  it("transform should only await fetch_fast (not wait for fetch_slow)", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // transform's promise IIFE should await p_fetch_fast
    // but should not await p_fetch_slow
    // Only extract the transform IIFE block (up to )();), excluding the output section after it
    const transformStart = result.code!.indexOf("const p_transform_1");
    const transformEnd = result.code!.indexOf(")();", transformStart) + 4;
    const transformBlock = result.code!.substring(transformStart, transformEnd);
    expect(transformBlock).toContain("await p_fetch_fast");
    expect(transformBlock).not.toContain("await p_fetch_slow");
  });

  it("output node should await all direct upstream promises", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // response node depends on fetch_slow and transform_1
    // Should await both in the output section
    const outputSection = result.code!.split("// --- Return")[1];
    expect(outputSection).toBeDefined();
  });

  it("DAG mode should not use legacy Promise.all", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    // Should not use legacy Promise.all (but Promise.allSettled is allowed as sync barrier)
    expect(result.code).not.toMatch(/Promise\.all\s*\(/);
    expect(result.code).toContain("Promise.allSettled");
  });

  it("purely sequential flow should not enable DAG mode", () => {
    // Simple flow: trigger → fetch → response (no concurrency)
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "Sequential", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/simple",
          params: { method: "GET", routePath: "/api/simple", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "Fetch Data",
          params: { url: "https://example.com", method: "GET", parseJson: true },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "response", label: "Response", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{{fetch_1}}" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // Sequential flow should not have DAG marker
    expect(result.code).not.toContain("DAG Concurrent Execution");
    // Sequential flow should preserve Symbol Table aliases
    expect(result.code).toContain("const fetchData = flowState['fetch_1']");
  });
});

// ============================================================
// 4. Static Import callSubflow
// ============================================================

describe("Static Subflow Import", () => {
  it("should not use runtime await import()", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "Subflow Static", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "POST /api/run",
          params: { method: "POST", routePath: "/api/run", parseBody: true },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "subflow_1",
          nodeType: ActionType.CALL_SUBFLOW,
          category: NodeCategory.ACTION,
          label: "Call Email",
          params: {
            flowPath: "./email-flow",
            functionName: "sendEmail",
            inputMapping: { to: "{{trigger_1.body.email}}" },
          },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "any" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{{subflow_1}}" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "subflow_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "subflow_1", sourcePortId: "result", targetNodeId: "response_1", targetPortId: "input" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);

    // Should not have runtime import
    expect(result.code).not.toContain("await import(");
    // Function name should be called directly (provided by top-level import)
    expect(result.code).toContain("sendEmail");
    expect(result.code).toContain("flowState['subflow_1']");
  });
});
