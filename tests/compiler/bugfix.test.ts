/**
 * 編譯器 Bug 修復驗證測試
 *
 * 對應 test.md 中記錄的 4 大測試狀況：
 * 1. Data Binding（資料流動斷層）
 * 2. HTTP Method 衝突與 Body 解析地雷
 * 3. Fetch API 錯誤處理太樂觀
 * 4. Error 拋出導致不優雅的伺服器錯誤
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  OutputType,
} from "@/lib/ir/types";

// ============================================================
// 狀況一：Data Binding 自動綁定（{{$input}} 解析）
// ============================================================

describe("Bug #1: Data Binding（$input 自動參照）", () => {
  it("{{$input}} 應解析為上一個非觸發器節點的 flowState", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "POST /api/data",
          params: { method: "POST", routePath: "/api/data", parseBody: true },
          inputs: [],
          outputs: [{ id: "body", label: "Body", dataType: "object" }],
        },
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "External API",
          params: { url: "https://api.example.com/data", method: "GET", parseJson: true },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "data", label: "Data", dataType: "any" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return Data",
          params: {
            statusCode: 200,
            bodyExpression: "{{$input}}",  // 使用 $input 自動參照
          },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "body", targetNodeId: "fetch_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // $input 應被解析為 fetch_1 的 flowState
    expect(result.code).toContain("flowState['fetch_1']");
    expect(result.code).toContain("NextResponse.json(flowState['fetch_1']");
  });

  it("{{$input}} 在只有觸發器連入時，應 fallback 到觸發器", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/echo",
          params: { method: "GET", routePath: "/api/echo", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Echo",
          params: {
            statusCode: 200,
            bodyExpression: "{{$input}}",
          },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // 無非觸發器前驅，應 fallback 到 trigger_1
    expect(result.code).toContain("flowState['trigger_1']");
  });

  it("{{$trigger}} 應解析為觸發器節點的 flowState", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "POST /api/proxy",
          params: { method: "POST", routePath: "/api/proxy", parseBody: true },
          inputs: [],
          outputs: [{ id: "body", label: "Body", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Echo Body",
          params: {
            statusCode: 200,
            bodyExpression: "{{$trigger.body}}",
          },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "body", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("flowState['trigger_1'].body");
  });
});

// ============================================================
// 狀況二：HTTP Method 衝突
// ============================================================

describe("Bug #2: HTTP Method 衝突與 Body 解析", () => {
  it("GET 請求不應生成 req.json()，應解析 searchParams", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/search",
          params: { method: "GET", routePath: "/api/search", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{{$input}}" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // GET 不應有 req.json()
    expect(result.code).not.toContain("req.json()");
    // GET 應解析 searchParams
    expect(result.code).toContain("req.nextUrl.searchParams");
    expect(result.code).toContain("Object.fromEntries");
    // GET 的提供者型別應為 NextRequest
    expect(result.code).toContain("req: NextRequest");
  });

  it("POST 的 req.json() 應被 try/catch 包覆", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "POST /api/submit",
          params: { method: "POST", routePath: "/api/submit", parseBody: true },
          inputs: [],
          outputs: [{ id: "body", label: "Body", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "OK",
          params: { statusCode: 200, bodyExpression: "{ ok: true }" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "body", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // POST 仍然應有 req.json()
    expect(result.code).toContain("await req.json()");
    // POST 的 req.json() 應被 try/catch 包覆
    expect(result.code).toContain("Invalid JSON body");
    expect(result.code).toContain("status: 400");
    // POST 的參數型別應為 Request（不需要 NextRequest）
    expect(result.code).toContain("req: Request");
  });

  it("DELETE 請求應像 GET 一樣處理（不讀 body）", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "DELETE /api/item",
          params: { method: "DELETE", routePath: "/api/item", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Deleted",
          params: { statusCode: 204, bodyExpression: "{ deleted: true }" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).not.toContain("req.json()");
    expect(result.code).toContain("searchParams");
    expect(result.code).toContain("NextRequest");
  });
});

// ============================================================
// 狀況三：Fetch API 錯誤處理
// ============================================================

describe("Bug #3: Fetch API response.ok 檢查", () => {
  it("Fetch 結果應檢查 response.ok", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
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
          label: "Call External",
          params: { url: "https://api.example.com/data", method: "GET", parseJson: true },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "data", label: "Data", dataType: "any" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{{$input}}" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // 應檢查 response.ok
    expect(result.code).toContain("if (!response.ok)");
    // 應有描述性錯誤訊息
    expect(result.code).toContain("response.status");
  });
});

// ============================================================
// 狀況四：全域 try/catch 錯誤攔截
// ============================================================

describe("Bug #4: 全域 try/catch 攔截（優雅的 JSON 錯誤）", () => {
  it("HTTP Webhook 的函式體應被 try/catch 包覆", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/safe",
          params: { method: "GET", routePath: "/api/safe", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{ ok: true }" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    // 應有全域 catch 回傳 JSON 錯誤
    expect(result.code).toContain("catch (error)");
    expect(result.code).toContain("Workflow failed");
    expect(result.code).toContain("Internal Server Error");
    expect(result.code).toContain("status: 500");
  });

  it("Fetch API 的 throw 應被全域 catch 攔截", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/ext",
          params: { method: "GET", routePath: "/api/ext", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "fetch_1",
          nodeType: ActionType.FETCH_API,
          category: NodeCategory.ACTION,
          label: "Risky Fetch",
          params: { url: "https://unstable.api/data", method: "GET", parseJson: true },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "data", label: "Data", dataType: "any" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{{$input}}" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    const code = result.code!;

    // Fetch 的 catch 會 re-throw
    expect(code).toContain("throw fetchError");
    // 全域 catch 會攔截並回傳 JSON
    expect(code).toContain("Workflow failed");
    expect(code).toContain("status: 500");
    // 不再有裸露的 throw 導致 HTML 錯誤
    expect(code).toContain("NextResponse.json({ error:");
  });
});
