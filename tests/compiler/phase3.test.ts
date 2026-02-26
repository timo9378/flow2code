/**
 * Phase 3 測試
 *
 * 驗證四個修復：
 *   1. Scope Stack — for-loop / try-catch 子節點正確解析局部作用域
 *   2. Partial<FlowState> — 型別安全，消除 `as FlowState`
 *   3. Sub-flow — call_subflow 節點代碼生成
 *   4. Fetch Envelope — parseJson=true 輸出 { data, status, headers }
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { parseExpression, type ExpressionContext, type ScopeEntry } from "@/lib/compiler/expression-parser";
import { inferFlowStateTypes } from "@/lib/compiler/type-inference";
import { registerPlugins } from "@/lib/compiler/plugins/types";
import { builtinPlugins } from "@/lib/compiler/plugins/builtin";
import type { FlowIR } from "@/lib/ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  OutputType,
  VariableType,
} from "@/lib/ir/types";

// 確保 plugins 已註冊
registerPlugins(builtinPlugins);

// ============================================================
// Helper: 建立含 for-loop + 子節點的 IR
// ============================================================

function createForLoopWithChildFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "Loop Test", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/users",
        params: { method: "POST", routePath: "/api/users", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "loop_1",
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
        id: "fetch_inner",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Update User",
        params: {
          url: "https://api.example.com/users",
          method: "POST",
          parseJson: true,
          body: "{{loop_1}}",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return Result",
        params: {
          statusCode: 200,
          bodyExpression: "{{loop_1}}",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "request",
        targetNodeId: "loop_1",
        targetPortId: "input",
      },
      {
        id: "e2",
        sourceNodeId: "loop_1",
        sourcePortId: "body",
        targetNodeId: "fetch_inner",
        targetPortId: "input",
      },
      {
        id: "e3",
        sourceNodeId: "loop_1",
        sourcePortId: "request",
        targetNodeId: "response_1",
        targetPortId: "input",
      },
    ],
  };
}

function createTryCatchWithChildFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "TryCatch Test", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/risky",
        params: { method: "POST", routePath: "/api/risky", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "try_1",
        nodeType: LogicType.TRY_CATCH,
        category: NodeCategory.LOGIC,
        label: "Try Risky",
        params: { errorVariable: "err" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "success", label: "Success", dataType: "any" },
          { id: "error", label: "Error", dataType: "any" },
        ],
      },
      {
        id: "fetch_success",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch On Success",
        params: {
          url: "https://api.example.com/ok",
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
        label: "Return Result",
        params: { statusCode: 200, bodyExpression: "{{try_1}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "request",
        targetNodeId: "try_1",
        targetPortId: "input",
      },
      {
        id: "e2",
        sourceNodeId: "try_1",
        sourcePortId: "success",
        targetNodeId: "fetch_success",
        targetPortId: "input",
      },
      {
        id: "e3",
        sourceNodeId: "try_1",
        sourcePortId: "request",
        targetNodeId: "response_1",
        targetPortId: "input",
      },
    ],
  };
}

// ============================================================
// 1. Scope Stack 測試
// ============================================================

describe("Scope Stack", () => {
  describe("Expression Parser with scopeStack", () => {
    it("scopeStack 為空時，應 fallback 到 flowState", () => {
      const ir: FlowIR = {
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [
          {
            id: "node_1",
            nodeType: TriggerType.MANUAL,
            category: NodeCategory.TRIGGER,
            label: "Test",
            params: { functionName: "test", args: [] },
            inputs: [],
            outputs: [],
          },
        ],
        edges: [],
      };
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));

      const ctx: ExpressionContext = { ir, nodeMap, scopeStack: [] };
      const result = parseExpression("{{node_1.data}}", ctx);
      expect(result).toBe("flowState['node_1'].data");
    });

    it("scopeStack 有匹配的 scope 時，應解析到 scope 變數", () => {
      const ir: FlowIR = {
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [
          {
            id: "loop_1",
            nodeType: LogicType.FOR_LOOP,
            category: NodeCategory.LOGIC,
            label: "Loop",
            params: { iterableExpression: "[]", itemVariable: "item" },
            inputs: [],
            outputs: [],
          },
        ],
        edges: [],
      };
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
      const scopeStack: ScopeEntry[] = [
        { nodeId: "loop_1", scopeVar: "_loopScope" },
      ];

      const ctx: ExpressionContext = { ir, nodeMap, scopeStack };
      const result = parseExpression("{{loop_1.userId}}", ctx);
      expect(result).toBe("_loopScope['loop_1'].userId");
    });

    it("巢狀 scope 應從最內層優先匹配", () => {
      const ir: FlowIR = {
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [
          {
            id: "loop_outer",
            nodeType: LogicType.FOR_LOOP,
            category: NodeCategory.LOGIC,
            label: "Outer",
            params: { iterableExpression: "[]", itemVariable: "a" },
            inputs: [],
            outputs: [],
          },
          {
            id: "loop_inner",
            nodeType: LogicType.FOR_LOOP,
            category: NodeCategory.LOGIC,
            label: "Inner",
            params: { iterableExpression: "[]", itemVariable: "b" },
            inputs: [],
            outputs: [],
          },
        ],
        edges: [],
      };
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
      const scopeStack: ScopeEntry[] = [
        { nodeId: "loop_outer", scopeVar: "_outerScope" },
        { nodeId: "loop_inner", scopeVar: "_innerScope" },
      ];

      const ctx: ExpressionContext = { ir, nodeMap, scopeStack };

      // inner scope 匹配
      expect(parseExpression("{{loop_inner.x}}", ctx)).toBe(
        "_innerScope['loop_inner'].x"
      );
      // outer scope 匹配
      expect(parseExpression("{{loop_outer.y}}", ctx)).toBe(
        "_outerScope['loop_outer'].y"
      );
    });

    it("scopeStack 不匹配時 fallback 到 flowState", () => {
      const ir: FlowIR = {
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [
          {
            id: "other_node",
            nodeType: TriggerType.MANUAL,
            category: NodeCategory.TRIGGER,
            label: "Test",
            params: { functionName: "test", args: [] },
            inputs: [],
            outputs: [],
          },
        ],
        edges: [],
      };
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
      const scopeStack: ScopeEntry[] = [
        { nodeId: "loop_1", scopeVar: "_loopScope" },
      ];

      const ctx: ExpressionContext = { ir, nodeMap, scopeStack };
      // other_node 不在 scope 中，走 flowState
      const result = parseExpression("{{other_node.data}}", ctx);
      expect(result).toBe("flowState['other_node'].data");
    });
  });

  describe("forLoopPlugin scope isolation", () => {
    it("for-loop 子節點的表達式應解析到 _loopScope", () => {
      const ir = createForLoopWithChildFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);

      // 子節點 fetch_inner 的 body `{{loop_1}}` 應解析到 _loopScope
      expect(result.code).toContain("_loopScope['loop_1']");
    });

    it("for-loop 外部引用應走 flowState", () => {
      const ir = createForLoopWithChildFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);

      // response_1 在 loop 外部引用 {{loop_1}}，應走 flowState
      // 因為 response_1 是在拓撲排序後生成，不在 loop body 內
      expect(result.code).toContain("flowState['loop_1']");
    });
  });

  describe("tryCatchPlugin scope isolation", () => {
    it("try-catch 子節點推入 _tryScope", () => {
      const ir = createTryCatchWithChildFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("_tryScope");
    });
  });
});

// ============================================================
// 2. Partial<FlowState> 測試
// ============================================================

describe("Partial<FlowState>", () => {
  it("FlowState 欄位應為 optional（?:）", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.MANUAL,
          category: NodeCategory.TRIGGER,
          label: "Test Trigger",
          params: { functionName: "test", args: [] },
          inputs: [],
          outputs: [{ id: "out", label: "Out", dataType: "any" }],
        },
      ],
      edges: [],
    };

    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.interfaceCode).toContain("'trigger_1'?:");
  });

  it("生成的代碼使用 Partial<FlowState> 而非 as FlowState", () => {
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
          params: { statusCode: 200, bodyExpression: '"ok"' },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [],
        },
      ],
      edges: [
        {
          id: "e1",
          sourceNodeId: "trigger_1",
          sourcePortId: "request",
          targetNodeId: "response_1",
          targetPortId: "input",
        },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("Partial<FlowState>");
    expect(result.code).not.toContain("as FlowState");
  });
});

// ============================================================
// 3. Sub-flow 測試
// ============================================================

describe("Call Subflow", () => {
  it("應生成 dynamic import + function call", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "Subflow Test", createdAt: "", updatedAt: "" },
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
          label: "Call Email Flow",
          params: {
            flowPath: "./email-flow",
            functionName: "sendEmail",
            inputMapping: {
              to: "{{trigger_1.body.email}}",
              subject: "{{trigger_1.body.subject}}",
            },
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
    expect(result.code).toContain('import("./email-flow")');
    expect(result.code).toContain("sendEmail");
    expect(result.code).toContain("flowState['subflow_1']");
  });

  it("CALL_SUBFLOW 應存在於 ActionType enum", () => {
    expect(ActionType.CALL_SUBFLOW).toBe("call_subflow");
  });
});

// ============================================================
// 4. Fetch Envelope 測試
// ============================================================

describe("Fetch Envelope", () => {
  it("parseJson=true 時應輸出 { data, status, headers } envelope", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "Fetch Envelope Test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/proxy",
          params: { method: "GET", routePath: "/api/proxy", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "Fetch External",
          params: {
            url: "https://api.example.com/data",
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

    // Envelope 結構
    expect(result.code).toContain("data,");
    expect(result.code).toContain("status: response.status,");
    expect(result.code).toContain("headers: Object.fromEntries(response.headers.entries()),");
  });

  it("parseJson=true 時 getOutputType 應返回 Envelope 型別", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "Fetch",
          params: {
            url: "https://example.com",
            method: "GET",
            parseJson: true,
          },
          inputs: [],
          outputs: [{ id: "response", label: "Response", dataType: "object" }],
        },
      ],
      edges: [],
    };

    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("fetch_1")).toBe(
      "{ data: unknown; status: number; headers: Record<string, string> }"
    );
  });

  it("parseJson=false 時仍返回 Response", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "Fetch Raw",
          params: {
            url: "https://example.com",
            method: "GET",
            parseJson: false,
          },
          inputs: [],
          outputs: [{ id: "response", label: "Response", dataType: "object" }],
        },
      ],
      edges: [],
    };

    const typeInfo = inferFlowStateTypes(ir);
    expect(typeInfo.nodeTypes.get("fetch_1")).toBe("Response");
  });
});
