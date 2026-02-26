/**
 * Expression Parser 測試
 *
 * 驗證新的 Recursive Descent Parser 正確取代 Regex 解析。
 */

import { describe, it, expect } from "vitest";
import { parseExpression, ExpressionParseError } from "@/lib/compiler/expression-parser";
import type { FlowIR, FlowNode, NodeId } from "@/lib/ir/types";
import { NodeCategory, TriggerType, ActionType, OutputType } from "@/lib/ir/types";

function makeContext(opts: {
  nodes?: FlowNode[];
  edges?: FlowIR["edges"];
  currentNodeId?: NodeId;
}) {
  const ir: FlowIR = {
    version: "1.0.0",
    meta: { name: "test", createdAt: "", updatedAt: "" },
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
  };
  return {
    ir,
    nodeMap: new Map(ir.nodes.map((n) => [n.id, n])),
    currentNodeId: opts.currentNodeId,
  };
}

describe("Expression Parser", () => {
  describe("基本模板解析", () => {
    it("純字串不含 {{ 時應原封不動返回", () => {
      const ctx = makeContext({});
      expect(parseExpression("hello world", ctx)).toBe("hello world");
    });

    it("{{nodeId}} 應解析為 flowState['nodeId']", () => {
      const ctx = makeContext({});
      expect(parseExpression("{{fetch_1}}", ctx)).toBe("flowState['fetch_1']");
    });

    it("{{nodeId.path}} 應解析為 flowState['nodeId'].path", () => {
      const ctx = makeContext({});
      expect(parseExpression("{{fetch_1.data}}", ctx)).toBe(
        "flowState['fetch_1'].data"
      );
    });

    it("{{nodeId.nested.path}} 應解析為 flowState['nodeId'].nested.path", () => {
      const ctx = makeContext({});
      expect(parseExpression("{{fetch_1.data.users}}", ctx)).toBe(
        "flowState['fetch_1'].data.users"
      );
    });

    it("{{nodeId.arr[0].name}} 應正確解析陣列索引", () => {
      const ctx = makeContext({});
      expect(parseExpression("{{fetch_1.arr[0].name}}", ctx)).toBe(
        "flowState['fetch_1'].arr[0].name"
      );
    });
  });

  describe("混合文字與引用", () => {
    it("should handle text before and after reference", () => {
      const ctx = makeContext({});
      expect(
        parseExpression("{ data: {{fetch_1}}, ok: true }", ctx)
      ).toBe("{ data: flowState['fetch_1'], ok: true }");
    });

    it("should handle multiple references in one expression", () => {
      const ctx = makeContext({});
      expect(
        parseExpression("{ a: {{node_a}}, b: {{node_b}} }", ctx)
      ).toBe("{ a: flowState['node_a'], b: flowState['node_b'] }");
    });
  });

  describe("特殊變數 $input", () => {
    it("{{$input}} 應解析為上游非觸發器節點", () => {
      const ctx = makeContext({
        nodes: [
          {
            id: "trigger_1",
            nodeType: TriggerType.HTTP_WEBHOOK,
            category: NodeCategory.TRIGGER,
            label: "T",
            params: { method: "GET", routePath: "/api/t", parseBody: false },
            inputs: [],
            outputs: [{ id: "out", label: "Out", dataType: "any" }],
          },
          {
            id: "fetch_1",
            nodeType: ActionType.FETCH_API,
            category: NodeCategory.ACTION,
            label: "F",
            params: { url: "http://x", method: "GET", parseJson: true },
            inputs: [{ id: "in", label: "In", dataType: "any", required: false }],
            outputs: [{ id: "data", label: "Data", dataType: "any" }],
          },
          {
            id: "response_1",
            nodeType: OutputType.RETURN_RESPONSE,
            category: NodeCategory.OUTPUT,
            label: "R",
            params: { statusCode: 200, bodyExpression: "{{$input}}" },
            inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
            outputs: [],
          },
        ],
        edges: [
          { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "out", targetNodeId: "fetch_1", targetPortId: "in" },
          { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
        ],
        currentNodeId: "response_1",
      });

      expect(parseExpression("{{$input}}", ctx)).toBe("flowState['fetch_1']");
    });

    it("{{$input.data.items}} 應包含子路徑", () => {
      const ctx = makeContext({
        nodes: [
          {
            id: "fetch_1",
            nodeType: ActionType.FETCH_API,
            category: NodeCategory.ACTION,
            label: "F",
            params: { url: "http://x", method: "GET", parseJson: true },
            inputs: [],
            outputs: [{ id: "data", label: "Data", dataType: "any" }],
          },
          {
            id: "response_1",
            nodeType: OutputType.RETURN_RESPONSE,
            category: NodeCategory.OUTPUT,
            label: "R",
            params: { statusCode: 200, bodyExpression: "test" },
            inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
            outputs: [],
          },
        ],
        edges: [
          { id: "e1", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
        ],
        currentNodeId: "response_1",
      });

      expect(parseExpression("{{$input.data.items}}", ctx)).toBe(
        "flowState['fetch_1'].data.items"
      );
    });
  });

  describe("特殊變數 $trigger", () => {
    it("{{$trigger}} 應解析為觸發器節點", () => {
      const ctx = makeContext({
        nodes: [
          {
            id: "trigger_1",
            nodeType: TriggerType.HTTP_WEBHOOK,
            category: NodeCategory.TRIGGER,
            label: "T",
            params: { method: "GET", routePath: "/test", parseBody: false },
            inputs: [],
            outputs: [{ id: "out", label: "Out", dataType: "any" }],
          },
        ],
      });

      expect(parseExpression("{{$trigger}}", ctx)).toBe("flowState['trigger_1']");
    });

    it("{{$trigger.body.userId}} 應正確帶路徑", () => {
      const ctx = makeContext({
        nodes: [
          {
            id: "trigger_1",
            nodeType: TriggerType.HTTP_WEBHOOK,
            category: NodeCategory.TRIGGER,
            label: "T",
            params: { method: "POST", routePath: "/test", parseBody: true },
            inputs: [],
            outputs: [{ id: "body", label: "Body", dataType: "object" }],
          },
        ],
      });

      expect(parseExpression("{{$trigger.body.userId}}", ctx)).toBe(
        "flowState['trigger_1'].body.userId"
      );
    });
  });

  describe("空白處理", () => {
    it("應正確處理 {{ 和 }} 內的空白", () => {
      const ctx = makeContext({});
      expect(parseExpression("{{ fetch_1.data }}", ctx)).toBe(
        "flowState['fetch_1'].data"
      );
    });

    it("應正確處理前後空白", () => {
      const ctx = makeContext({});
      expect(parseExpression("{{  $trigger  }}", ctx)).toBe(
        // No trigger registered, should return "undefined"
        "undefined"
      );
    });
  });

  describe("錯誤處理", () => {
    it("未關閉的 {{ 應拋出 ExpressionParseError", () => {
      const ctx = makeContext({});
      expect(() => parseExpression("{{unclosed", ctx)).toThrow(
        ExpressionParseError
      );
    });

    it("空的 {{}} 應拋出 ExpressionParseError", () => {
      const ctx = makeContext({});
      expect(() => parseExpression("{{}}", ctx)).toThrow(ExpressionParseError);
    });
  });

  describe("逃脫序列", () => {
    it("\\\\{{ 應輸出字面 {{", () => {
      const ctx = makeContext({});
      expect(parseExpression("\\{{literal}}", ctx)).toBe("{{literal}}");
    });
  });
});
