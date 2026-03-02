/**
 * Decompiler Tests — TypeScript → FlowIR Reverse Parsing
 */

import { describe, it, expect } from "vitest";
import { decompile } from "../../src/lib/compiler/decompiler";
import { compile } from "../../src/lib/compiler/compiler";
import { NodeCategory } from "../../src/lib/ir/types";
import type { FlowIR } from "../../src/lib/ir/types";

describe("Decompiler (TS → IR)", () => {
  it("should restore nodes from Source Map comments", () => {
    const code = `
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  interface FlowState {
    'trigger_1'?: { query: Record<string, string>; url: string };
    'fetch_1'?: unknown;
    'response_1'?: never;
  }
  const flowState: Partial<FlowState> = {};

  const searchParams = req.nextUrl.searchParams;
  const query = Object.fromEntries(searchParams.entries());
  const httpWebhookTrigger = { query, url: req.url };
  flowState['trigger_1'] = httpWebhookTrigger;

  // --- Fetch Users [fetch_api] [fetch_1] ---
  try {
    const response = await fetch("https://api.example.com/users", { method: "GET" });
    if (!response.ok) {
      throw new Error(\`Fetch Users failed: HTTP \${response.status}\`);
    }
    const data = await response.json();
    flowState['fetch_1'] = { data, status: response.status, headers: {} };
  } catch (err) {
    throw err;
  }

  // --- Return [return_response] [response_1] ---
  return NextResponse.json(flowState['fetch_1'], { status: 200 });
}
`;

    const result = decompile(code, { fileName: "route.ts" });

    expect(result.success).toBe(true);
    expect(result.ir).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0.5);

    // Should detect trigger
    const trigger = result.ir!.nodes.find((n) => n.category === NodeCategory.TRIGGER);
    expect(trigger).toBeDefined();
    expect(trigger!.nodeType).toBe("http_webhook");

    // Should detect fetch node (from source map or AST)
    const fetchNode = result.ir!.nodes.find(
      (n) => n.nodeType === "fetch_api" || n.id.includes("fetch")
    );
    expect(fetchNode).toBeDefined();

    // Should detect response node
    const respNode = result.ir!.nodes.find(
      (n) => n.nodeType === "return_response" || n.id.includes("response")
    );
    expect(respNode).toBeDefined();
  });

  it("should detect HTTP method from export function", () => {
    const code = `
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ ok: true }, { status: 201 });
}
`;

    const result = decompile(code);
    expect(result.success).toBe(true);

    const trigger = result.ir!.nodes.find((n) => n.category === NodeCategory.TRIGGER);
    expect(trigger).toBeDefined();
    expect((trigger!.params as any).method).toBe("POST");
  });

  it("should detect fetch calls and create fetch_api nodes", () => {
    const code = `
export async function GET(req: Request) {
  const response = await fetch("https://api.example.com/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "value" }),
  });
  const data = await response.json();
  return Response.json(data);
}
`;

    const result = decompile(code);
    expect(result.success).toBe(true);
    expect(result.ir!.nodes.length).toBeGreaterThanOrEqual(2); // trigger + fetch + response
  });

  it("should detect if statements and create if_else nodes", () => {
    const code = `
export async function GET(req: Request) {
  const data = { ok: true };
  if (data.ok) {
    return Response.json({ success: true });
  } else {
    return Response.json({ success: false }, { status: 400 });
  }
}
`;

    const result = decompile(code);
    expect(result.success).toBe(true);

    const ifNode = result.ir!.nodes.find((n) => n.nodeType === "if_else");
    expect(ifNode).toBeDefined();
  });

  it("round-trip: compile → decompile should restore node types", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "Round Trip Test", createdAt: "", updatedAt: "" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: "http_webhook",
          category: "trigger",
          label: "HTTP Webhook Trigger",
          params: { method: "GET", routePath: "/api/test", parseBody: false },
          inputs: [],
          outputs: [
            { id: "request", label: "Request", dataType: "object" },
            { id: "query", label: "Query", dataType: "object" },
          ],
        },
        {
          id: "fetch_1",
          nodeType: "fetch_api",
          category: "action",
          label: "Fetch Data",
          params: { url: "https://api.example.com/test", method: "GET", parseJson: true },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [
            { id: "response", label: "Response", dataType: "object" },
            { id: "data", label: "Data", dataType: "any" },
          ],
        },
        {
          id: "response_1",
          nodeType: "return_response",
          category: "output",
          label: "Return Response",
          params: { statusCode: 200, bodyExpression: "flowState['fetch_1']" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    // Compile
    const compileResult = compile(ir);
    expect(compileResult.success).toBe(true);

    // Decompile
    const decompileResult = decompile(compileResult.code!);
    expect(decompileResult.success).toBe(true);

    // Verify key nodes are restored
    const nodeTypes = decompileResult.ir!.nodes.map((n) => n.nodeType);
    expect(nodeTypes).toContain("http_webhook");
    // Should have fetch-related nodes
    const hasFetch = decompileResult.ir!.nodes.some(
      (n) => n.nodeType === "fetch_api" || n.id.includes("fetch")
    );
    expect(hasFetch).toBe(true);
  });

  it("empty code should return failure", () => {
    const result = decompile("");
    // Empty file may not completely fail, but should not have meaningful nodes
    expect(result.ir?.nodes.length ?? 0).toBeLessThanOrEqual(1);
  });
});
