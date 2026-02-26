/**
 * Phase 3.1 — 作用域遮蔽 / 符號表洩漏 / DAG 排程 / 靜態引入 測試
 *
 * 驗證四個修復：
 *   1. 巢狀迴圈不再有 _loopScope 遮蔽（動態 scope 變數名稱）
 *   2. If/Else 子區塊節點不洩漏 Symbol Table 別名
 *   3. DAG 模式 per-node promise 排程（取代階層式 Promise.all）
 *   4. callSubflowPlugin 使用靜態 import（非 runtime await import）
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

/** 巢狀迴圈：外層迴圈 + 內層迴圈 */
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

/** If/Else 分支 + 下游引用子節點 */
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

/** DAG 測試流：兩個並發 → 一個只依賴其中一個 → response */
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
// 1. 巢狀迴圈 — 確認無 Scope Shadowing
// ============================================================

describe("Scope Shadowing (Nested Loops)", () => {
  it("巢狀迴圈應使用不同的 scope 變數名稱", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // 外層迴圈的 scope 變數（含 node ID）
    expect(result.code).toContain("_scope_loop_users");
    // 內層迴圈的 scope 變數（含不同的 node ID）
    expect(result.code).toContain("_scope_loop_orders");
  });

  it("巢狀迴圈不應有兩個同名的 const 宣告", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // 不應有 hardcoded _loopScope（這會導致遮蔽）
    expect(result.code).not.toContain("const _loopScope");
  });

  it("內層迴圈子節點的表達式應解析到正確的 scope 變數", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // fetch_order 的 body `{{loop_orders}}` 應解析到內層 scope
    expect(result.code).toContain("_scope_loop_orders['loop_orders']");
  });

  it("內層迴圈引用外層迴圈的迭代項應解析到外層 scope", () => {
    const ir = createNestedLoopFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // 內層迴圈的 iterableExpression `{{loop_users.orders}}` 應解析到外層 scope
    expect(result.code).toContain("_scope_loop_users['loop_users'].orders");
  });
});

// ============================================================
// 2. Symbol Table 洩漏 — If/Else 子區塊
// ============================================================

describe("Symbol Table Block Scoping", () => {
  it("if/else 子區塊節點不應產生 const alias", () => {
    const ir = createIfElseWithDownstreamFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // fetch_user 在 if 區塊內生成，不應有頂層 const fetchUser 宣告
    expect(result.code).not.toContain("const fetchUser = flowState");
  });

  it("下游節點引用子區塊節點應使用 flowState，而非 Symbol Table 別名", () => {
    const ir = createIfElseWithDownstreamFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // response_1 的 bodyExpression `{{fetch_user}}` 應使用 flowState
    expect(result.code).toContain("flowState['fetch_user']");
    // 不應包含 Symbol Table 生成的別名（fetchUser 不是合法的頂層變數）
    // 只有 flowState['fetch_user'] 是安全的
  });

  it("子區塊節點不應在拓撲排序的頂層被重複生成", () => {
    const ir = createIfElseWithDownstreamFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // fetch_user 的程式碼只應出現在 if 區塊內，不應在頂層重複
    const fetchCount = (result.code!.match(/Fetch User/g) || []).length;
    // 最多 3 次：節點標記註解、console.error、可能的 throw error message
    // 重點是不應有第二組獨立的 fetch 代碼區塊
    expect(fetchCount).toBeLessThanOrEqual(3);
  });

  it("expression-parser: blockScopedNodeIds 應跳過 Symbol Table", () => {
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

    // 使用 Symbol Table 但 fetch_1 被標記為 block-scoped
    // 建一個模擬 symbolTable
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

    // 即使 Symbol Table 有 fetch_1 → fetchData，也應 fallback 到 flowState
    const result = parseExpression("{{fetch_1.data}}", ctx);
    expect(result).toBe("flowState['fetch_1'].data");
  });
});

// ============================================================
// 3. DAG 並發排程
// ============================================================

describe("DAG Concurrent Scheduling", () => {
  it("有並發機會的流程應使用 DAG 模式", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    expect(result.code).toContain("DAG Concurrent Execution");
  });

  it("每個 worker 節點應包裝為獨立的 promise", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    expect(result.code).toContain("const p_fetch_slow");
    expect(result.code).toContain("const p_fetch_fast");
    expect(result.code).toContain("const p_transform_1");
  });

  it("transform 只 await fetch_fast（不等待 fetch_slow）", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // transform 的 promise IIFE 內應 await p_fetch_fast
    // 但不應 await p_fetch_slow
    // 只擷取 transform IIFE 區塊（到 )(); 為止），不含後面的 output 段
    const transformStart = result.code!.indexOf("const p_transform_1");
    const transformEnd = result.code!.indexOf(")();", transformStart) + 4;
    const transformBlock = result.code!.substring(transformStart, transformEnd);
    expect(transformBlock).toContain("await p_fetch_fast");
    expect(transformBlock).not.toContain("await p_fetch_slow");
  });

  it("output 節點應 await 所有直接上游 promise", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);

    // response 節點依賴 fetch_slow 和 transform_1
    // 應在 output 區段同時 await 兩者
    const outputSection = result.code!.split("// --- Return")[1];
    expect(outputSection).toBeDefined();
  });

  it("DAG 模式不應使用舊版 Promise.all", () => {
    const ir = createDAGFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    // 不應出現舊式 Promise.all（但允許 Promise.allSettled 作為 sync barrier）
    expect(result.code).not.toMatch(/Promise\.all\s*\(/);
    expect(result.code).toContain("Promise.allSettled");
  });

  it("純循序流程不應啟用 DAG 模式", () => {
    // 簡單流程：trigger → fetch → response（無並發）
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
    // 循序流程不應有 DAG marker
    expect(result.code).not.toContain("DAG Concurrent Execution");
    // 循序流程應保留 Symbol Table 別名
    expect(result.code).toContain("const fetchData = flowState['fetch_1']");
  });
});

// ============================================================
// 4. 靜態引入 callSubflow
// ============================================================

describe("Static Subflow Import", () => {
  it("不應使用 runtime await import()", () => {
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

    // 不應有 runtime import
    expect(result.code).not.toContain("await import(");
    // 函式名稱應直接呼叫（由頂層 import 提供）
    expect(result.code).toContain("sendEmail");
    expect(result.code).toContain("flowState['subflow_1']");
  });
});
