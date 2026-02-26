/**
 * OpenAPI → FlowIR 轉換器測試
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
// 基本解析
// ============================================================

describe("OpenAPI 基本解析", () => {
  it("應正確解析最簡 OpenAPI 規範", () => {
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

  it("應處理字串輸入（JSON 序列化）", () => {
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

  it("無效 JSON 應回傳解析錯誤", () => {
    const result = convertOpenAPIToFlowIR("not valid json{{{");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("JSON 解析失敗");
    expect(result.flows).toHaveLength(0);
  });

  it("缺少 paths 欄位應回傳驗證錯誤", () => {
    const result = convertOpenAPIToFlowIR({ openapi: "3.0.0" } as any);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("openapi 或 paths");
  });

  it("缺少 openapi 欄位應回傳驗證錯誤", () => {
    const result = convertOpenAPIToFlowIR({ paths: {} } as any);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// 多端點
// ============================================================

describe("OpenAPI 多端點轉換", () => {
  it("一個 path 多個 method 應各產生獨立 FlowIR", () => {
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

  it("多個 path 應各產生 FlowIR", () => {
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
// 路徑轉換
// ============================================================

describe("OpenAPI 路徑轉換", () => {
  it("應將 {param} 轉為 [param]", () => {
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

  it("非 /api 開頭的路徑應自動加上 /api 前綴", () => {
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

  it("已有 /api 前綴的路徑不應重複", () => {
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
// HTTP Method 對應
// ============================================================

describe("OpenAPI Method 對應", () => {
  it("GET 不應標記 parseBody", () => {
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

  it("POST 有 requestBody 時應標記 parseBody", () => {
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

  it("成功狀態碼應被正確提取", () => {
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
// Tags 與 metadata
// ============================================================

describe("OpenAPI Tags 和 metadata", () => {
  it("應收集所有 tags 到 summary", () => {
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

  it("operationId 應被用作 FlowIR name", () => {
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
  it("query 參數應產生 queryParams 定義", () => {
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
// 節點結構
// ============================================================

describe("OpenAPI 轉換節點結構", () => {
  it("最簡 GET 應產生 2 個節點（Trigger + Return）和 1 條 edge", () => {
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

  it("有 path 參數的 GET 應多一個 Transform 節點", () => {
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

  it("edges 應正確連接節點", () => {
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
// 空 paths
// ============================================================

describe("OpenAPI 邊界情況", () => {
  it("空 paths 應產生 0 個 flow", () => {
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
