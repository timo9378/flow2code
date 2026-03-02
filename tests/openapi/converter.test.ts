/**
 * OpenAPI → FlowIR Converter Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  convertOpenAPIToFlowIR,
  resetIdCounter,
} from "@/lib/openapi/converter";
import {
  NodeCategory,
  TriggerType,
  OutputType,
} from "@/lib/ir/types";

beforeEach(() => {
  resetIdCounter();
});

// ============================================================
// Basic Parsing
// ============================================================

describe("OpenAPI Basic Parsing", () => {
  it("should correctly parse a minimal OpenAPI spec", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            operationId: "getUsers",
            summary: "List users",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.success).toBe(true);
    expect(result.flows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.totalPaths).toBe(1);
    expect(result.summary.totalOperations).toBe(1);
  });

  it("should handle string input (JSON serialized)", () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/items": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    });

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.success).toBe(true);
    expect(result.flows).toHaveLength(1);
  });

  it("invalid JSON should return parse error", () => {
    const result = convertOpenAPIToFlowIR("not valid json{{{");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("JSON parse failed");
    expect(result.flows).toHaveLength(0);
  });

  it("missing paths field should return validation error", () => {
    const result = convertOpenAPIToFlowIR({ openapi: "3.0.0" } as any);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("openapi or paths");
  });

  it("missing openapi field should return validation error", () => {
    const result = convertOpenAPIToFlowIR({ paths: {} } as any);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// Multiple Endpoints
// ============================================================

describe("OpenAPI Multiple Endpoint Conversion", () => {
  it("one path with multiple methods should each produce a separate FlowIR", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
          post: { responses: { "201": { description: "Created" } } },
          delete: { responses: { "204": { description: "Deleted" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.success).toBe(true);
    expect(result.flows).toHaveLength(3);
    expect(result.summary.totalOperations).toBe(3);
    expect(result.summary.totalPaths).toBe(1);
  });

  it("multiple paths should each produce FlowIR", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
        },
        "/items": {
          get: { responses: { "200": { description: "OK" } } },
        },
        "/orders": {
          post: { responses: { "201": { description: "Created" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.flows).toHaveLength(3);
    expect(result.summary.totalPaths).toBe(3);
  });
});

// ============================================================
// Path Conversion
// ============================================================

describe("OpenAPI Path Conversion", () => {
  it("should convert {param} to [param]", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{user_id}": {
          get: {
            parameters: [
              { name: "user_id", in: "path" as const, required: true },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.success).toBe(true);
    const triggerNode = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    )!;
    expect((triggerNode.params as any).routePath).toBe("/api/users/[user_id]");
  });

  it("paths not starting with /api should have /api prefix added", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/health": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const triggerNode = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    )!;
    expect((triggerNode.params as any).routePath).toBe("/api/health");
  });

  it("paths already with /api prefix should not be duplicated", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/api/v1/data": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const triggerNode = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    )!;
    expect((triggerNode.params as any).routePath).toBe("/api/v1/data");
  });
});

// ============================================================
// HTTP Method Mapping
// ============================================================

describe("OpenAPI Method Mapping", () => {
  it("GET should not set parseBody", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/items": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const trigger = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    )!;
    expect((trigger.params as any).parseBody).toBe(false);
    expect((trigger.params as any).method).toBe("GET");
  });

  it("POST with requestBody should set parseBody", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/items": {
          post: {
            requestBody: {
              content: { "application/json": { schema: {} } },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const trigger = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    )!;
    expect((trigger.params as any).parseBody).toBe(true);
    expect((trigger.params as any).method).toBe("POST");
  });

  it("success status code should be correctly extracted", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/items": {
          post: {
            responses: {
              "201": { description: "Created" },
              "400": { description: "Bad Request" },
            },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const responseNode = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.OUTPUT
    )!;
    expect((responseNode.params as any).statusCode).toBe(201);
  });
});

// ============================================================
// Tags and Metadata
// ============================================================

describe("OpenAPI Tags and Metadata", () => {
  it("should collect all tags into summary", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            tags: ["Users", "Admin"],
            responses: { "200": { description: "OK" } },
          },
        },
        "/items": {
          get: {
            tags: ["Items"],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.summary.tags).toEqual(["Admin", "Items", "Users"]);
  });

  it("operationId should be used as FlowIR name", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            operationId: "listAllUsers",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.flows[0].meta.name).toBe("listAllUsers");
  });
});

// ============================================================
// Query Parameters
// ============================================================

describe("OpenAPI Query Parameters", () => {
  it("query parameters should produce queryParams definitions", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/search": {
          get: {
            parameters: [
              { name: "q", in: "query" as const, required: true, schema: { type: "string" } },
              { name: "limit", in: "query" as const, schema: { type: "integer" } },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const trigger = result.flows[0].nodes.find(
      (n) => n.category === NodeCategory.TRIGGER
    )!;
    const queryParams = (trigger.params as any).queryParams;
    expect(queryParams).toBeDefined();
    expect(queryParams).toHaveLength(2);
    expect(queryParams[0].name).toBe("q");
    expect(queryParams[0].required).toBe(true);
    expect(queryParams[1].name).toBe("limit");
    expect(queryParams[1].type).toBe("number");
  });
});

// ============================================================
// Node Structure
// ============================================================

describe("OpenAPI Conversion Node Structure", () => {
  it("minimal GET should produce 2 nodes (Trigger + Return) and 1 edge", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/ping": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const flow = result.flows[0];
    expect(flow.nodes).toHaveLength(2);
    expect(flow.edges).toHaveLength(1);
    expect(flow.nodes[0].category).toBe(NodeCategory.TRIGGER);
    expect(flow.nodes[1].category).toBe(NodeCategory.OUTPUT);
  });

  it("GET with path parameter should have one more Transform node", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          get: {
            parameters: [
              { name: "id", in: "path" as const, required: true },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const flow = result.flows[0];
    // Trigger + Transform + Return
    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges).toHaveLength(2);
  });

  it("edges should correctly connect nodes", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/data": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    };

    const result = convertOpenAPIToFlowIR(spec);
    const edge = result.flows[0].edges[0];
    expect(edge.sourceNodeId).toBe(result.flows[0].nodes[0].id);
    expect(edge.targetNodeId).toBe(result.flows[0].nodes[1].id);
  });
});

// ============================================================
// Empty Paths
// ============================================================

describe("OpenAPI Edge Cases", () => {
  it("empty paths should produce 0 flows", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };

    const result = convertOpenAPIToFlowIR(spec);
    expect(result.success).toBe(true);
    expect(result.flows).toHaveLength(0);
    expect(result.summary.totalOperations).toBe(0);
  });
});
