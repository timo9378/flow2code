/**
 * Compiler Bug Fix Verification Tests
 *
 * Corresponds to the 4 major test scenarios documented in test.md:
 * 1. Data Binding (data flow disconnection)
 * 2. HTTP Method conflicts and body parsing pitfalls
 * 3. Fetch API error handling too optimistic
 * 4. Error throwing leads to ungraceful server errors
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
// Scenario 1: Data Binding Auto-binding ({{$input}} resolution)
// ============================================================

describe("Bug #1: Data Binding ($input auto-reference)", () => {
  it("{{$input}} should resolve to the flowState of the previous non-trigger node", () => {
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
            bodyExpression: "{{$input}}",  // Using $input auto-reference
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
    // $input should resolve to fetch_1's named variable (Symbol Table)
    expect(result.code).toContain("flowState['fetch_1']"); // plugin still writes to flowState
    // v3: expression uses named variable instead of flowState
    expect(result.code).toContain("externalApi");
  });

  it("{{$input}} should fallback to trigger when only trigger is connected", () => {
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
    // No non-trigger predecessors, should fallback to trigger_1
    expect(result.code).toContain("flowState['trigger_1']");
  });

  it("{{$trigger}} should resolve to the trigger node's flowState", () => {
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
    // v3: {{$trigger.body}} resolves to the trigger's named variable
    expect(result.code).toContain("postApiProxy.body");
  });
});

// ============================================================
// Scenario 2: HTTP Method Conflicts
// ============================================================

describe("Bug #2: HTTP Method Conflicts and Body Parsing", () => {
  it("GET request should not generate req.json(), should parse searchParams", () => {
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
    // GET should not have req.json()
    expect(result.code).not.toContain("req.json()");
    // GET should parse searchParams
    expect(result.code).toContain("req.nextUrl.searchParams");
    expect(result.code).toContain("Object.fromEntries");
    // GET's provider type should be NextRequest
    expect(result.code).toContain("req: NextRequest");
  });

  it("POST's req.json() should be wrapped in try/catch", () => {
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
    // POST should still have req.json()
    expect(result.code).toContain("await req.json()");
    // POST's req.json() should be wrapped in try/catch
    expect(result.code).toContain("Invalid JSON body");
    expect(result.code).toContain("status: 400");
    // POST's parameter type should be Request (no need for NextRequest)
    expect(result.code).toContain("req: Request");
  });

  it("DELETE request should be handled like GET (no body reading)", () => {
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
// Scenario 3: Fetch API Error Handling
// ============================================================

describe("Bug #3: Fetch API response.ok check", () => {
  it("Fetch result should check response.ok", () => {
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
    // Should check response.ok
    expect(result.code).toContain("if (!response.ok)");
    // Should have descriptive error message
    expect(result.code).toContain("response.status");
  });
});

// ============================================================
// Scenario 4: Global try/catch Error Interception
// ============================================================

describe("Bug #4: Global try/catch Interception (graceful JSON errors)", () => {
  it("HTTP Webhook function body should be wrapped in try/catch", () => {
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
    // Should have global catch returning JSON error
    expect(result.code).toContain("catch (error)");
    expect(result.code).toContain("Workflow failed");
    expect(result.code).toContain("Internal Server Error");
    expect(result.code).toContain("status: 500");
  });

  it("Fetch API's throw should be caught by global catch", () => {
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

    // Fetch's catch will re-throw
    expect(code).toContain("throw fetchError");
    // Global catch will intercept and return JSON
    expect(code).toContain("Workflow failed");
    expect(code).toContain("status: 500");
    // No more bare throw causing HTML errors
    expect(code).toContain("NextResponse.json({ error:");
  });
});
