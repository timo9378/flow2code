/**
 * Dependency Sync and Source Map Tests
 * 
 * Verifies that the compiler correctly tracks dependency packages and generates Source Maps.
 */

import { describe, it, expect } from "vitest";
import { compile, traceLineToNode } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  OutputType,
} from "@/lib/ir/types";
import {
  createSimpleGetFlow,
  createPostWithFetchFlow,
  createConcurrentFlow,
} from "../fixtures";

// ============================================================
// Dependency Sync Tests
// ============================================================

describe("Dependency Sync", () => {
  it("should report no dependencies for basic HTTP flow", () => {
    const ir = createSimpleGetFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    expect(result.dependencies).toBeDefined();
    expect(result.dependencies!.all).toEqual([]);
  });

  it("should detect Redis dependency", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: {
        name: "Redis Flow",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/cache",
          params: { method: "GET", routePath: "/api/cache", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "redis_1",
          nodeType: ActionType.REDIS_CACHE,
          category: NodeCategory.ACTION,
          label: "Get Cache",
          params: { operation: "get", key: "user_cache" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "value", label: "Value", dataType: "any" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "flowState['redis_1']" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "redis_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "redis_1", sourcePortId: "value", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.dependencies!.all).toContain("ioredis");
  });

  it("should detect Drizzle ORM dependency for SQL queries", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: {
        name: "SQL Flow",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/users",
          params: { method: "GET", routePath: "/api/users", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "sql_1",
          nodeType: ActionType.SQL_QUERY,
          category: NodeCategory.ACTION,
          label: "Query Users",
          params: { orm: "drizzle", query: "SELECT * FROM users", params: [] },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "array" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "flowState['sql_1']" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "sql_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "sql_1", sourcePortId: "result", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.dependencies!.all).toContain("drizzle-orm");
  });

  it("should detect Prisma dependency", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: {
        name: "Prisma Flow",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET /api/data",
          params: { method: "GET", routePath: "/api/data", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "sql_1",
          nodeType: ActionType.SQL_QUERY,
          category: NodeCategory.ACTION,
          label: "Query",
          params: { orm: "prisma", query: "SELECT 1", params: [] },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "array" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "flowState['sql_1']" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "sql_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "sql_1", sourcePortId: "result", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.dependencies!.all).toContain("@prisma/client");
  });

  it("should provide install command for missing packages", () => {
    const ir: FlowIR = {
      version: "1.0.0",
      meta: { name: "Multi-dep", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
      nodes: [
        {
          id: "trigger_1",
          nodeType: TriggerType.HTTP_WEBHOOK,
          category: NodeCategory.TRIGGER,
          label: "GET",
          params: { method: "GET", routePath: "/api/multi", parseBody: false },
          inputs: [],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "redis_1",
          nodeType: ActionType.REDIS_CACHE,
          category: NodeCategory.ACTION,
          label: "Cache",
          params: { operation: "get", key: "k" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "value", label: "Value", dataType: "any" }],
        },
        {
          id: "sql_1",
          nodeType: ActionType.SQL_QUERY,
          category: NodeCategory.ACTION,
          label: "DB",
          params: { orm: "drizzle", query: "SELECT 1" },
          inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
          outputs: [{ id: "result", label: "Result", dataType: "array" }],
        },
        {
          id: "response_1",
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: "Return",
          params: { statusCode: 200, bodyExpression: "{}" },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "redis_1", targetPortId: "input" },
        { id: "e2", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "sql_1", targetPortId: "input" },
        { id: "e3", sourceNodeId: "redis_1", sourcePortId: "value", targetNodeId: "response_1", targetPortId: "data" },
        { id: "e4", sourceNodeId: "sql_1", sourcePortId: "result", targetNodeId: "response_1", targetPortId: "data" },
      ],
    };

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.dependencies!.all).toContain("ioredis");
    expect(result.dependencies!.all).toContain("drizzle-orm");
    expect(result.dependencies!.installCommand).toContain("npm install");
  });
});

// ============================================================
// Source Map Tests
// ============================================================

describe("Source Map", () => {
  it("should generate sourceMap for compiled code", () => {
    const ir = createSimpleGetFlow();
    const result = compile(ir);

    expect(result.success).toBe(true);
    expect(result.sourceMap).toBeDefined();
    expect(result.sourceMap!.version).toBe(1);
    expect(result.sourceMap!.generatedFile).toContain("route.ts");
  });

  it("should map trigger node in sourceMap", () => {
    const ir = createSimpleGetFlow();
    const result = compile(ir);

    expect(result.sourceMap!.mappings).toBeDefined();
    const triggerMapping = result.sourceMap!.mappings["trigger_1"];
    expect(triggerMapping).toBeDefined();
    expect(triggerMapping.startLine).toBeGreaterThan(0);
  });

  it("should map action nodes in sourceMap", () => {
    const ir = createPostWithFetchFlow();
    const result = compile(ir);

    expect(result.sourceMap!.mappings["fetch_1"]).toBeDefined();
    expect(result.sourceMap!.mappings["fetch_1"].startLine).toBeGreaterThan(0);
    expect(result.sourceMap!.mappings["fetch_1"].endLine).toBeGreaterThan(
      result.sourceMap!.mappings["fetch_1"].startLine
    );
  });

  it("should support traceLineToNode lookup", () => {
    const ir = createPostWithFetchFlow();
    const result = compile(ir);
    const sourceMap = result.sourceMap!;

    // Get the mapping range for fetch_1
    const fetchMapping = sourceMap.mappings["fetch_1"];
    if (fetchMapping) {
      const trace = traceLineToNode(sourceMap, fetchMapping.startLine);
      expect(trace).not.toBeNull();
      expect(trace!.nodeId).toBe("fetch_1");
    }
  });

  it("should return null for unmapped lines", () => {
    const ir = createSimpleGetFlow();
    const result = compile(ir);
    const sourceMap = result.sourceMap!;

    // Line 0 does not exist
    const trace = traceLineToNode(sourceMap, 0);
    expect(trace).toBeNull();
  });
});
