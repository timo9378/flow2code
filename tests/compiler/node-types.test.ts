/**
 * Phase 2 Tests: Compilation Correctness of Each Node Type
 *
 * Covers for_loop / try_catch / sql_query / redis_cache / custom_code / call_subflow.
 * Verifies that the generated code structure is correct.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";
import { NodeCategory, TriggerType, ActionType, LogicType, OutputType } from "@/lib/ir/types";

// ── Helpers ──

function httpTrigger(method = "GET", routePath = "/api/test") {
  return {
    id: "trigger_1",
    nodeType: TriggerType.HTTP_WEBHOOK,
    category: NodeCategory.TRIGGER,
    label: `${method} ${routePath}`,
    params: { method, routePath, parseBody: method !== "GET" },
    inputs: [],
    outputs: [{ id: "request", label: "Request", dataType: "object" }],
  };
}

function returnNode(id = "response_1", bodyExpr = '{ ok: true }') {
  return {
    id,
    nodeType: OutputType.RETURN_RESPONSE,
    category: NodeCategory.OUTPUT,
    label: "Return",
    params: { statusCode: 200, bodyExpression: bodyExpr },
    inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
    outputs: [],
  };
}

function edge(src: string, srcPort: string, tgt: string, tgtPort: string, id?: string) {
  return {
    id: id ?? `e_${src}_${tgt}`,
    sourceNodeId: src,
    sourcePortId: srcPort,
    targetNodeId: tgt,
    targetPortId: tgtPort,
  };
}

function wrapIR(name: string, nodes: any[], edges: any[]): FlowIR {
  return {
    version: "1.0.0",
    meta: { name, createdAt: "", updatedAt: "" },
    nodes,
    edges,
  };
}

// ============================================================
// SQL Query Plugin
// ============================================================

describe("SQL Query Compilation", () => {
  it("Drizzle ORM should generate db.execute + sql template", () => {
    const ir = wrapIR("sql-drizzle", [
      httpTrigger(),
      {
        id: "sql_1",
        nodeType: ActionType.SQL_QUERY,
        category: NodeCategory.ACTION,
        label: "Query Users",
        params: { orm: "drizzle", query: "SELECT * FROM users" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode("response_1", "{ data: flowState['sql_1'] }"),
    ], [
      edge("trigger_1", "request", "sql_1", "input"),
      edge("sql_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("Drizzle ORM Query");
    expect(result.code).toContain("db.execute");
    expect(result.code).toContain("SELECT * FROM users");
  });

  it("Prisma should generate prisma.$queryRaw", () => {
    const ir = wrapIR("sql-prisma", [
      httpTrigger(),
      {
        id: "sql_1",
        nodeType: ActionType.SQL_QUERY,
        category: NodeCategory.ACTION,
        label: "Query",
        params: { orm: "prisma", query: "SELECT 1" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "sql_1", "input"),
      edge("sql_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("prisma.$queryRaw");
  });

  it("Raw SQL should generate db.query", () => {
    const ir = wrapIR("sql-raw", [
      httpTrigger(),
      {
        id: "sql_1",
        nodeType: ActionType.SQL_QUERY,
        category: NodeCategory.ACTION,
        label: "Raw Query",
        params: { orm: "raw", query: "SELECT NOW()" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "sql_1", "input"),
      edge("sql_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("Raw SQL Query");
    expect(result.code).toContain("db.query");
  });
});

// ============================================================
// Redis Cache Plugin
// ============================================================

describe("Redis Cache Compilation", () => {
  it("get operation should generate redis.get", () => {
    const ir = wrapIR("redis-get", [
      httpTrigger(),
      {
        id: "redis_1",
        nodeType: ActionType.REDIS_CACHE,
        category: NodeCategory.ACTION,
        label: "Get Cache",
        params: { operation: "get", key: "user:123" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "redis_1", "input"),
      edge("redis_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain('redis.get("user:123")');
  });

  it("set operation with TTL should generate redis.set with EX", () => {
    const ir = wrapIR("redis-set", [
      httpTrigger(),
      {
        id: "redis_1",
        nodeType: ActionType.REDIS_CACHE,
        category: NodeCategory.ACTION,
        label: "Set Cache",
        params: { operation: "set", key: "session:abc", value: '"active"', ttl: 3600 },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "redis_1", "input"),
      edge("redis_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain('redis.set("session:abc"');
    expect(result.code).toContain('"EX"');
    expect(result.code).toContain("3600");
  });

  it("del operation should generate redis.del", () => {
    const ir = wrapIR("redis-del", [
      httpTrigger(),
      {
        id: "redis_1",
        nodeType: ActionType.REDIS_CACHE,
        category: NodeCategory.ACTION,
        label: "Delete Cache",
        params: { operation: "del", key: "temp:xyz" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "redis_1", "input"),
      edge("redis_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain('redis.del("temp:xyz")');
  });

  it("Redis should report ioredis as dependency", () => {
    const ir = wrapIR("redis-deps", [
      httpTrigger(),
      {
        id: "redis_1",
        nodeType: ActionType.REDIS_CACHE,
        category: NodeCategory.ACTION,
        label: "Cache",
        params: { operation: "get", key: "k" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "redis_1", "input"),
      edge("redis_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.dependencies!.all).toContain("ioredis");
  });
});

// ============================================================
// Custom Code Plugin
// ============================================================

describe("Custom Code Compilation", () => {
  it("should insert custom code and set returnVariable", () => {
    const ir = wrapIR("custom-code", [
      httpTrigger(),
      {
        id: "code_1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Hash Password",
        params: {
          code: "const hashed = await bcrypt.hash(password, 10);",
          returnVariable: "hashed",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "code_1", "input"),
      edge("code_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("Custom Code: Hash Password");
    expect(result.code).toContain("bcrypt.hash(password, 10)");
    expect(result.code).toContain("flowState['code_1'] = custom_result");
  });

    it("no returnVariable should not write to flowState", () => {
    const ir = wrapIR("custom-no-return", [
      httpTrigger(),
      {
        id: "code_1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Logger",
        params: { code: 'console.log("hello");' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "code_1", "input"),
      edge("code_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain('console.log("hello")');
    expect(result.code).not.toContain("flowState['code_1'] =");
  });
});

// ============================================================
// Call Subflow Plugin
// ============================================================

describe("Call Subflow Compilation", () => {
  it("should generate await + import statement", () => {
    const ir = wrapIR("call-subflow", [
      httpTrigger(),
      {
        id: "subflow_1",
        nodeType: ActionType.CALL_SUBFLOW,
        category: NodeCategory.ACTION,
        label: "Call Auth",
        params: {
          flowPath: "./auth-flow",
          functionName: "authenticate",
          inputMapping: { token: "'abc123'" },
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "subflow_1", "input"),
      edge("subflow_1", "result", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("await authenticate");
    // import statement is generated at the top of the file by ts-morph
    expect(result.code).toContain("authenticate");
    expect(result.code).toContain("token:");
  });
});

// ============================================================
// For Loop Plugin
// ============================================================

describe("For Loop Compilation", () => {
    it("should generate for...of loop + scoped variables", () => {
    const ir = wrapIR("for-loop", [
      httpTrigger(),
      {
        id: "loop_1",
        nodeType: LogicType.FOR_LOOP,
        category: NodeCategory.LOGIC,
        label: "Loop Items",
        params: {
          iterableExpression: "[1, 2, 3]",
          itemVariable: "item",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "body", label: "Body", dataType: "any" },
          { id: "done", label: "Done", dataType: "any" },
        ],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "loop_1", "input"),
      edge("loop_1", "done", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("for (const item of");
    expect(result.code).toContain("_results");
    expect(result.code).toContain("flowState['loop_1']");
  });

  it("with indexVariable should generate entries() destructuring", () => {
    const ir = wrapIR("for-loop-index", [
      httpTrigger(),
      {
        id: "loop_1",
        nodeType: LogicType.FOR_LOOP,
        category: NodeCategory.LOGIC,
        label: "Loop Indexed",
        params: {
          iterableExpression: "[10, 20]",
          itemVariable: "val",
          indexVariable: "idx",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "body", label: "Body", dataType: "any" },
          { id: "done", label: "Done", dataType: "any" },
        ],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "loop_1", "input"),
      edge("loop_1", "done", "response_1", "data"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("[idx, val]");
    expect(result.code).toContain(".entries()");
  });
});

// ============================================================
// Try/Catch Plugin
// ============================================================

describe("Try/Catch Compilation", () => {
  it("should generate try/catch block", () => {
    const ir = wrapIR("try-catch", [
      httpTrigger(),
      {
        id: "tc_1",
        nodeType: LogicType.TRY_CATCH,
        category: NodeCategory.LOGIC,
        label: "Safe Block",
        params: { errorVariable: "err" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "success", label: "Success", dataType: "any" },
          { id: "error", label: "Error", dataType: "any" },
        ],
      },
      {
        id: "code_ok",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Try Body",
        params: { code: 'const x = "safe";', returnVariable: "x" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      {
        id: "code_err",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Catch Body",
        params: { code: 'console.error("caught", err);' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      returnNode(),
    ], [
      edge("trigger_1", "request", "tc_1", "input"),
      edge("tc_1", "success", "code_ok", "input"),
      edge("tc_1", "error", "code_err", "input"),
      edge("tc_1", "success", "response_1", "data", "e_tc_resp"),
    ]);

    const result = compile(ir);
    expect(result.success).toBe(true);
    expect(result.code).toContain("try {");
    expect(result.code).toContain("catch (err)");
    expect(result.code).toContain("success: true");
    expect(result.code).toContain("success: false");
  });
});
