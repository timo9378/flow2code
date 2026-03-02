/**
 * Phase 2 Tests: Platform Trigger Init Correctness
 *
 * Verifies trigger init code generation for Express / Cloudflare / Next.js platforms.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";
import { NodeCategory, TriggerType, OutputType } from "@/lib/ir/types";

function httpTriggerIR(method: string, routePath: string): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "trigger-init-test", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: `${method} ${routePath}`,
        params: { method, routePath, parseBody: !["GET", "DELETE"].includes(method) },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: { statusCode: 200, bodyExpression: '{ ok: true }' },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "request",
        targetNodeId: "response_1",
        targetPortId: "data",
      },
    ],
  };
}

function cronIR(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "cron-test", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.CRON_JOB,
        category: NodeCategory.TRIGGER,
        label: "Daily Job",
        params: { schedule: "0 0 * * *", functionName: "dailyCleanup" },
        inputs: [],
        outputs: [{ id: "trigger", label: "Trigger", dataType: "object" }],
      },
      {
        id: "code_1",
        nodeType: "custom_code" as any,
        category: NodeCategory.ACTION,
        label: "Cleanup",
        params: { code: 'console.log("cleanup");' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "trigger",
        targetNodeId: "code_1",
        targetPortId: "input",
      },
    ],
  };
}

function manualIR(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "manual-test", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.MANUAL,
        category: NodeCategory.TRIGGER,
        label: "Run Task",
        params: {
          functionName: "processData",
          args: [
            { name: "input", type: "string" },
            { name: "count", type: "number" },
          ],
        },
        inputs: [],
        outputs: [{ id: "trigger", label: "Trigger", dataType: "object" }],
      },
      {
        id: "code_1",
        nodeType: "custom_code" as any,
        category: NodeCategory.ACTION,
        label: "Process",
        params: { code: 'console.log("processing");' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "trigger",
        targetNodeId: "code_1",
        targetPortId: "input",
      },
    ],
  };
}

// ============================================================
// Next.js Trigger Init
// ============================================================

describe("Next.js Trigger Init", () => {
  it("GET should generate req.nextUrl.searchParams", () => {
    const result = compile(httpTriggerIR("GET", "/api/search"), { platform: "nextjs" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("req.nextUrl.searchParams");
    expect(result.code).toContain("Object.fromEntries");
  });

  it("POST should generate await req.json()", () => {
    const result = compile(httpTriggerIR("POST", "/api/data"), { platform: "nextjs" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("await req.json()");
    expect(result.code).toContain("NextResponse.json");
  });

  it("DELETE should use searchParams (same as GET)", () => {
    const result = compile(httpTriggerIR("DELETE", "/api/item"), { platform: "nextjs" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("searchParams");
  });

  it("Cron trigger should generate triggeredAt", () => {
    const result = compile(cronIR(), { platform: "nextjs" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("triggeredAt");
    expect(result.code).toContain("new Date().toISOString()");
  });

  it("Manual trigger should destructure args", () => {
    const result = compile(manualIR(), { platform: "nextjs" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("input, count");
  });
});

// ============================================================
// Express Trigger Init
// ============================================================

describe("Express Trigger Init", () => {
  it("GET should generate req.query", () => {
    const result = compile(httpTriggerIR("GET", "/api/search"), { platform: "express" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("req.query");
    expect(result.code).toContain("req.originalUrl");
    expect(result.code).not.toContain("nextUrl");
  });

  it("POST should generate req.body", () => {
    const result = compile(httpTriggerIR("POST", "/api/data"), { platform: "express" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("req.body");
    expect(result.code).toContain("req.originalUrl");
    expect(result.code).not.toContain("req.json()");
  });

  it("DELETE should use req.query (same as GET)", () => {
    const result = compile(httpTriggerIR("DELETE", "/api/item"), { platform: "express" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("req.query");
  });

  it("Cron trigger should generate triggeredAt", () => {
    const result = compile(cronIR(), { platform: "express" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("triggeredAt");
  });

  it("Manual trigger should destructure args", () => {
    const result = compile(manualIR(), { platform: "express" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("input, count");
  });
});

// ============================================================
// Cloudflare Workers Trigger Init
// ============================================================

describe("Cloudflare Trigger Init", () => {
  it("GET should generate new URL(request.url) + searchParams", () => {
    const result = compile(httpTriggerIR("GET", "/api/search"), { platform: "cloudflare" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("new URL(request.url)");
    expect(result.code).toContain("url.searchParams");
    expect(result.code).not.toContain("nextUrl");
  });

  it("POST should generate await request.json()", () => {
    const result = compile(httpTriggerIR("POST", "/api/data"), { platform: "cloudflare" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("await request.json()");
    expect(result.code).toContain("new Response");
    expect(result.code).not.toContain("NextResponse");
  });

  it("should include export default { fetch } pattern", () => {
    const result = compile(httpTriggerIR("GET", "/api/test"), { platform: "cloudflare" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("export default");
    expect(result.code).toContain("async fetch");
  });

  it("Cron trigger should generate triggeredAt", () => {
    const result = compile(cronIR(), { platform: "cloudflare" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("triggeredAt");
  });

  it("Manual trigger should destructure args", () => {
    const result = compile(manualIR(), { platform: "cloudflare" });
    expect(result.success).toBe(true);
    expect(result.code).toContain("input, count");
  });
});
