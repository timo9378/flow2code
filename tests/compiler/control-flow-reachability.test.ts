/**
 * Reachability Analysis & Promise Safety Tests
 *
 * Verifies three critical fixes:
 *   Boss 1: DAG mode no longer duplicates sub-block nodes (Pre-computed childBlockNodeIds)
 *   Boss 2: Downstream of control flow child nodes no longer leaks to top level (Block Continuation)
 *   Boss 3: DAG Promises have .catch guards & Promise.allSettled barrier
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
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

/**
 * Boss 1 Scenario: If/Else with child nodes in DAG mode
 *
 * trigger ──→ fetch_a ──→ if_1 ──true──→ fetch_child
 *          └─→ fetch_b ──→ response_1
 *
 * fetch_a and fetch_b run in parallel (triggers DAG mode).
 * fetch_child is a true branch child of if_1, should not appear in top-level DAG.
 */
function createDAGWithIfElse(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "DAG + If/Else", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/test",
        params: { method: "POST", routePath: "/api/test", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "fetch_a",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch A",
        params: { url: "https://api-a.example.com", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "fetch_b",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch B",
        params: { url: "https://api-b.example.com", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Check A",
        params: { condition: "{{fetch_a.data.ok}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "fetch_child",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch Child",
        params: { url: "https://api-child.example.com", method: "POST", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: { statusCode: 200, bodyExpression: "{{fetch_b}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_a", targetPortId: "input" },
      { id: "e2", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_b", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_a", sourcePortId: "response", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e4", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "fetch_child", targetPortId: "input" },
      { id: "e5", sourceNodeId: "fetch_b", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
      { id: "e6", sourceNodeId: "if_1", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
    ],
  };
}

/**
 * Boss 2 Scenario: If/Else true branch downstream chain
 *
 * trigger ──→ if_1 ──true──→ fetch_a ──→ write_db
 *                   └false──→ response_err (400)
 *            └──→ response_ok (200, uses write_db result)
 *
 * fetch_a and write_db must both be inside the if (true) { ... } block.
 * write_db must not leak to the top level.
 */
function createIfElseWithDownstreamChain(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "If/Else Chain", createdAt: "", updatedAt: "" },
    nodes: [
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
        label: "Check Valid",
        params: { condition: "{{trigger_1.body.valid}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "fetch_a",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch API",
        params: { url: "https://api.example.com/data", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "write_db",
        nodeType: ActionType.SQL_QUERY,
        category: NodeCategory.ACTION,
        label: "Write DB",
        params: {
          orm: "drizzle",
          operation: "custom",
          customQuery: "INSERT INTO logs (data) VALUES ({{fetch_a.data}})",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "object" }],
      },
      {
        id: "response_err",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Error Response",
        params: { statusCode: 400, bodyExpression: '"invalid"' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
      {
        id: "response_ok",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "OK Response",
        params: { statusCode: 200, bodyExpression: "{{if_1}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "fetch_a", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_a", sourcePortId: "response", targetNodeId: "write_db", targetPortId: "input" },
      { id: "e4", sourceNodeId: "if_1", sourcePortId: "false", targetNodeId: "response_err", targetPortId: "input" },
      { id: "e5", sourceNodeId: "if_1", sourcePortId: "output", targetNodeId: "response_ok", targetPortId: "input" },
    ],
  };
}

// ============================================================
// Boss 1: DAG Duplicate Generation Fix
// ============================================================

describe("Boss 1: DAG should not duplicate sub-block nodes", () => {
  it("If/Else child nodes should not appear in top-level DAG promise", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // fetch_child should not have its own top-level promise IIFE
    expect(code).not.toMatch(/const p_fetch_child\s*=/);

    // fetch_child should be generated inside the if block
    expect(code).toContain("if (");
    expect(code).toContain("Fetch Child");
  });

  it("fetch_child's code should only appear once (no duplicate declarations)", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // Fetch Child's comment marker should only appear once
    const mentions = code.match(/--- Fetch Child/g);
    expect(mentions).toHaveLength(1);
  });
});

// ============================================================
// Boss 2: Control Flow Child Node Downstream Leak Prevention
// ============================================================

describe("Boss 2: Control Flow descendant nodes should not leak to top level", () => {
  it("write_db should be inside the if block (not at top level)", () => {
    const ir = createIfElseWithDownstreamChain();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // write_db should be generated (exists in the code)
    expect(code).toContain("Write DB");

    // Locate the position of the if block and write_db
    const ifPos = code.indexOf("if (");
    const writeDbPos = code.indexOf("Write DB");

    // write_db should appear after if (meaning it's inside the if block)
    expect(ifPos).toBeGreaterThan(-1);
    expect(writeDbPos).toBeGreaterThan(ifPos);

    // write_db should not appear as a top-level independent statement outside the if block
    // Check that write_db comment appears between the if block's braces {}
    const ifBlock = code.substring(ifPos);
    const firstCloseBrace = findMatchingBrace(ifBlock);
    const writeDbRelPos = ifBlock.indexOf("Write DB");
    expect(writeDbRelPos).toBeLessThan(firstCloseBrace);
  });

  it("fetch_a must also be inside the if block", () => {
    const ir = createIfElseWithDownstreamChain();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    const ifPos = code.indexOf("if (");
    const fetchAPos = code.indexOf("Fetch API");

    expect(ifPos).toBeGreaterThan(-1);
    expect(fetchAPos).toBeGreaterThan(ifPos);
  });
});

// ============================================================
// Boss 3: Promise Safety
// ============================================================

describe("Boss 3: DAG Promise Safety", () => {
  it("each DAG promise should have .catch guard", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // Find all DAG promise variables
    const promiseDecls = code.match(/const (p_\w+)\s*=\s*\(async/g);
    expect(promiseDecls).toBeTruthy();
    expect(promiseDecls!.length).toBeGreaterThan(0);

    // Each promise should have a corresponding .catch
    for (const decl of promiseDecls!) {
      const varName = decl.match(/const (p_\w+)/)?.[1];
      expect(code).toContain(`${varName}.catch(() => {`);
    }
  });

  it("should have Promise.allSettled barrier before Output", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // Should contain Promise.allSettled
    expect(code).toContain("Promise.allSettled");

    // Promise.allSettled should be before the Output node marker
    const barrierPos = code.indexOf("Promise.allSettled");
    const outputCommentMatch = code.match(/\/\/ --- Return \(return_response\)/);
    const outputCommentPos = outputCommentMatch ? code.indexOf(outputCommentMatch[0]) : -1;
    expect(barrierPos).toBeGreaterThan(-1);
    expect(outputCommentPos).toBeGreaterThan(-1);
    expect(barrierPos).toBeLessThan(outputCommentPos);
  });
});

// ============================================================
// Helper
// ============================================================

/** Simple brace matching: find the position of } corresponding to the first { */
function findMatchingBrace(code: string): number {
  let depth = 0;
  let started = false;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") {
      depth++;
      started = true;
    } else if (code[i] === "}") {
      depth--;
      if (started && depth === 0) return i;
    }
  }
  return code.length;
}
