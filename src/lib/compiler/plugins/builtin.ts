/**
 * Built-in Node Plugins
 *
 * 從編譯器核心提取出的所有內建節點代碼生成器。
 * 每個生成器遵循 NodePlugin 介面，可被外部 Plugin 覆蓋。
 */

import type { FlowNode, NodeId } from "../../ir/types";
import {
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
  NodeCategory,
} from "../../ir/types";
import type {
  FetchApiParams,
  SqlQueryParams,
  RedisCacheParams,
  CustomCodeParams,
  CallSubflowParams,
  IfElseParams,
  ForLoopParams,
  TryCatchParams,
  DeclareVariableParams,
  TransformParams,
  ReturnResponseParams,
  HttpWebhookParams,
} from "../../ir/types";
import type { NodePlugin, PluginContext } from "./types";
import type { CodeBlockWriter } from "ts-morph";

// ============================================================
// Trigger Plugins (No-ops, 已在 Platform Adapter 處理)
// ============================================================

const httpWebhookPlugin: NodePlugin = {
  nodeType: TriggerType.HTTP_WEBHOOK,
  generate: () => {},
  getOutputType(node) {
    const params = node.params as HttpWebhookParams;
    if (["GET", "DELETE"].includes(params.method)) {
      return "{ query: Record<string, string>; url: string }";
    }
    if (params.parseBody) {
      return "{ body: unknown; url: string }";
    }
    return "{ url: string }";
  },
};

const cronJobPlugin: NodePlugin = {
  nodeType: TriggerType.CRON_JOB,
  generate: () => {},
  getOutputType: () => "{ triggeredAt: string }",
};

const manualPlugin: NodePlugin = {
  nodeType: TriggerType.MANUAL,
  generate: () => {},
  getOutputType: () => "Record<string, unknown>",
};

// ============================================================
// Action Plugins
// ============================================================

const fetchApiPlugin: NodePlugin = {
  nodeType: ActionType.FETCH_API,

  generate(node, writer, context) {
    const params = node.params as FetchApiParams;
    const url = context.resolveEnvVars(params.url);

    writer.write("try ").block(() => {
      const hasBody =
        params.body && ["POST", "PUT", "PATCH"].includes(params.method);

      writer.writeLine(`const response = await fetch(${url}, {`);
      writer.writeLine(`  method: "${params.method}",`);

      if (params.headers && Object.keys(params.headers).length > 0) {
        writer.writeLine(`  headers: ${JSON.stringify(params.headers)},`);
      } else if (hasBody) {
        writer.writeLine(
          `  headers: { "Content-Type": "application/json" },`
        );
      }

      if (hasBody) {
        const bodyExpr = context.resolveExpression(params.body!, node.id);
        writer.writeLine(`  body: JSON.stringify(${bodyExpr}),`);
      }

      writer.writeLine("});");
      writer.blankLine();

      writer.write("if (!response.ok) ").block(() => {
        writer.writeLine(
          `throw new Error(\`${node.label} failed: HTTP \${response.status} \${response.statusText}\`);`
        );
      });
      writer.blankLine();

      if (params.parseJson) {
        writer.writeLine(`const data = await response.json();`);
        writer.writeLine(`flowState['${node.id}'] = {`);
        writer.writeLine(`  data,`);
        writer.writeLine(`  status: response.status,`);
        writer.writeLine(`  headers: Object.fromEntries(response.headers.entries()),`);
        writer.writeLine(`};`);
      } else {
        writer.writeLine(`flowState['${node.id}'] = response;`);
      }
    });
    writer.write(" catch (fetchError) ").block(() => {
      writer.writeLine(
        `console.error("Fetch failed for ${node.label}:", fetchError);`
      );
      writer.writeLine(`throw fetchError;`);
    });
  },

  getRequiredPackages: () => [],

  getOutputType(node) {
    const params = node.params as FetchApiParams;
    return params.parseJson
      ? "{ data: unknown; status: number; headers: Record<string, string> }"
      : "Response";
  },
};

const sqlQueryPlugin: NodePlugin = {
  nodeType: ActionType.SQL_QUERY,

  generate(node, writer) {
    const params = node.params as SqlQueryParams;

    switch (params.orm) {
      case "drizzle":
        writer.writeLine(`// Drizzle ORM Query`);
        writer.writeLine(
          `const result = await db.execute(sql\`${params.query}\`);`
        );
        writer.writeLine(`flowState['${node.id}'] = result;`);
        break;
      case "prisma":
        writer.writeLine(`// Prisma Query`);
        writer.writeLine(
          `const result = await prisma.$queryRaw\`${params.query}\`;`
        );
        writer.writeLine(`flowState['${node.id}'] = result;`);
        break;
      case "raw":
      default:
        writer.writeLine(`// Raw SQL Query`);
        writer.writeLine(
          `const result = await db.query(\`${params.query}\`);`
        );
        writer.writeLine(`flowState['${node.id}'] = result;`);
        break;
    }
  },

  getRequiredPackages(node) {
    const params = node.params as SqlQueryParams;
    const map: Record<string, string[]> = {
      drizzle: ["drizzle-orm"],
      prisma: ["@prisma/client"],
      raw: [],
    };
    return map[params.orm] ?? [];
  },

  getOutputType: () => "unknown[]",
};

const redisCachePlugin: NodePlugin = {
  nodeType: ActionType.REDIS_CACHE,

  generate(node, writer) {
    const params = node.params as RedisCacheParams;

    switch (params.operation) {
      case "get":
        writer.writeLine(
          `flowState['${node.id}'] = await redis.get("${params.key}");`
        );
        break;
      case "set":
        if (params.ttl) {
          writer.writeLine(
            `await redis.set("${params.key}", ${params.value ?? "null"}, "EX", ${params.ttl});`
          );
        } else {
          writer.writeLine(
            `await redis.set("${params.key}", ${params.value ?? "null"});`
          );
        }
        writer.writeLine(`flowState['${node.id}'] = true;`);
        break;
      case "del":
        writer.writeLine(`await redis.del("${params.key}");`);
        writer.writeLine(`flowState['${node.id}'] = true;`);
        break;
    }
  },

  getRequiredPackages: () => ["ioredis"],

  getOutputType(node) {
    const params = node.params as RedisCacheParams;
    return params.operation === "get" ? "string | null" : "boolean";
  },
};

const customCodePlugin: NodePlugin = {
  nodeType: ActionType.CUSTOM_CODE,

  generate(node, writer) {
    const params = node.params as CustomCodeParams;

    writer.writeLine(`// Custom Code: ${node.label}`);
    for (const line of params.code.split("\n")) {
      writer.writeLine(line);
    }
    if (params.returnVariable) {
      writer.writeLine(`flowState['${node.id}'] = ${params.returnVariable};`);
    }
  },

  getOutputType: () => "unknown",
};

const callSubflowPlugin: NodePlugin = {
  nodeType: ActionType.CALL_SUBFLOW,

  generate(node, writer, context) {
    const params = node.params as CallSubflowParams;

    // 解析輸入映射表達式
    const args = Object.entries(params.inputMapping)
      .map(([key, expr]) => {
        const resolved = context.resolveExpression(expr, node.id);
        return `${key}: ${resolved}`;
      })
      .join(", ");

    writer.writeLine(
      `const { ${params.functionName} } = await import("${params.flowPath}");`
    );
    writer.writeLine(
      `flowState['${node.id}'] = await ${params.functionName}({ ${args} });`
    );
  },

  getOutputType: () => "unknown",
};

// ============================================================
// Logic Plugins
// ============================================================

const ifElsePlugin: NodePlugin = {
  nodeType: LogicType.IF_ELSE,

  generate(node, writer, context) {
    const params = node.params as IfElseParams;

    const trueEdges = context.ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "true"
    );
    const falseEdges = context.ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "false"
    );

    const conditionExpr = context.resolveExpression(
      params.condition,
      node.id
    );

    writer.write(`if (${conditionExpr}) `).block(() => {
      writer.writeLine(`flowState['${node.id}'] = true;`);
      for (const edge of trueEdges) {
        const childNode = context.nodeMap.get(edge.targetNodeId);
        if (childNode) {
          context.generateChildNode(writer, childNode);
        }
      }
    });

    if (falseEdges.length > 0) {
      writer.write(" else ").block(() => {
        writer.writeLine(`flowState['${node.id}'] = false;`);
        for (const edge of falseEdges) {
          const childNode = context.nodeMap.get(edge.targetNodeId);
          if (childNode) {
            context.generateChildNode(writer, childNode);
          }
        }
      });
    }
  },

  getOutputType: () => "boolean",
};

const forLoopPlugin: NodePlugin = {
  nodeType: LogicType.FOR_LOOP,

  generate(node, writer, context) {
    const params = node.params as ForLoopParams;
    const iterableExpr = context.resolveExpression(
      params.iterableExpression,
      node.id
    );
    const sanitizedId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    // 使用作用域隔離，防止迴圈內變數污染全域 flowState
    writer.writeLine(`const ${sanitizedId}_results: unknown[] = [];`);

    if (params.indexVariable) {
      writer.write(
        `for (const [${params.indexVariable}, ${params.itemVariable}] of (${iterableExpr}).entries()) `
      );
    } else {
      writer.write(
        `for (const ${params.itemVariable} of ${iterableExpr}) `
      );
    }

    writer.block(() => {
      // 建立迴圈內的局部 scope
      writer.writeLine(
        `const _loopScope: Record<string, unknown> = {};`
      );

      // 將迴圈迭代項注入 scope
      writer.writeLine(
        `_loopScope['${node.id}'] = ${params.itemVariable};`
      );

      // 推入作用域：子節點對 node.id 的引用會解析到 _loopScope
      context.pushScope(node.id, '_loopScope');

      // 生成迴圈體內子節點
      const childEdges = context.ir.edges.filter(
        (e) => e.sourceNodeId === node.id && e.sourcePortId === "body"
      );
      for (const edge of childEdges) {
        const childNode = context.nodeMap.get(edge.targetNodeId);
        if (childNode) {
          context.generateChildNode(writer, childNode);
        }
      }

      // 彈出作用域
      context.popScope();

      writer.writeLine(`${sanitizedId}_results.push(${params.itemVariable});`);
    });

    writer.writeLine(`flowState['${node.id}'] = ${sanitizedId}_results;`);
  },

  getOutputType: () => "unknown[]",
};

const tryCatchPlugin: NodePlugin = {
  nodeType: LogicType.TRY_CATCH,

  generate(node, writer, context) {
    const params = node.params as TryCatchParams;

    const successEdges = context.ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "success"
    );
    const errorEdges = context.ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "error"
    );

    writer.write("try ").block(() => {
      // 建立 try 區塊的局部 scope
      writer.writeLine(
        `const _tryScope: Record<string, unknown> = {};`
      );

      // 推入作用域：子節點對 node.id 的引用會解析到 _tryScope
      context.pushScope(node.id, '_tryScope');

      for (const edge of successEdges) {
        const childNode = context.nodeMap.get(edge.targetNodeId);
        if (childNode) {
          context.generateChildNode(writer, childNode);
        }
      }

      context.popScope();

      writer.writeLine(
        `flowState['${node.id}'] = { success: true };`
      );
    });
    writer.write(` catch (${params.errorVariable}) `).block(() => {
      writer.writeLine(
        `console.error("Error in ${node.label}:", ${params.errorVariable});`
      );
      // 建立 catch 區塊的局部 scope
      writer.writeLine(
        `const _catchScope: Record<string, unknown> = {};`
      );
      writer.writeLine(
        `flowState['${node.id}'] = { success: false, error: ${params.errorVariable} };`
      );

      // 推入作用域：子節點對 node.id 的引用會解析到 _catchScope
      context.pushScope(node.id, '_catchScope');

      for (const edge of errorEdges) {
        const childNode = context.nodeMap.get(edge.targetNodeId);
        if (childNode) {
          context.generateChildNode(writer, childNode);
        }
      }

      context.popScope();
    });
  },

  getOutputType: () => "{ success: boolean; error?: unknown }",
};

const promiseAllPlugin: NodePlugin = {
  nodeType: LogicType.PROMISE_ALL,

  generate(node, writer) {
    writer.writeLine(`// Promise.all handled by concurrent execution`);
    writer.writeLine(
      `flowState['${node.id}'] = undefined; // populated by concurrent handler`
    );
  },

  getOutputType: () => "unknown[]",
};

// ============================================================
// Variable Plugins
// ============================================================

const declarePlugin: NodePlugin = {
  nodeType: VariableType.DECLARE,

  generate(node, writer) {
    const params = node.params as DeclareVariableParams;
    const keyword = params.isConst ? "const" : "let";
    const initialValue = params.initialValue ?? "undefined";

    writer.writeLine(`${keyword} ${params.name} = ${initialValue};`);
    writer.writeLine(`flowState['${node.id}'] = ${params.name};`);
  },

  getOutputType(node) {
    const params = node.params as DeclareVariableParams;
    return params.dataType;
  },
};

const transformPlugin: NodePlugin = {
  nodeType: VariableType.TRANSFORM,

  generate(node, writer, context) {
    const params = node.params as TransformParams;
    const expr = context.resolveExpression(params.expression, node.id);

    writer.writeLine(`flowState['${node.id}'] = ${expr};`);
  },

  getOutputType: () => "unknown",
};

// ============================================================
// Output Plugins
// ============================================================

/**
 * Return Response Plugin
 * 注意：此 Plugin 需要 platform adapter 提供 generateResponse
 * 目前直接使用 NextResponse.json (由 compiler 在整合時處理)
 */
const returnResponsePlugin: NodePlugin = {
  nodeType: OutputType.RETURN_RESPONSE,

  generate(node, writer, context) {
    const params = node.params as ReturnResponseParams;
    const bodyExpr = context.resolveExpression(
      params.bodyExpression,
      node.id
    );

    // 委託給 platform adapter（透過 context.__platformResponse）
    // 如果沒有 platform，fallback 到 NextResponse（向後相容）
    const ctx = context as PluginContext & {
      __platformResponse?: (
        writer: CodeBlockWriter,
        bodyExpr: string,
        statusCode: number,
        headers?: Record<string, string>
      ) => void;
    };

    if (ctx.__platformResponse) {
      ctx.__platformResponse(writer, bodyExpr, params.statusCode, params.headers);
    } else {
      // Fallback: 直接使用 NextResponse（向後相容）
      if (params.headers && Object.keys(params.headers).length > 0) {
        writer.writeLine(
          `return NextResponse.json(${bodyExpr}, { status: ${params.statusCode}, headers: ${JSON.stringify(params.headers)} });`
        );
      } else {
        writer.writeLine(
          `return NextResponse.json(${bodyExpr}, { status: ${params.statusCode} });`
        );
      }
    }
  },

  getOutputType: () => "never",
};

// ============================================================
// 匯出所有內建 Plugins
// ============================================================

export const builtinPlugins: NodePlugin[] = [
  // Triggers
  httpWebhookPlugin,
  cronJobPlugin,
  manualPlugin,
  // Actions
  fetchApiPlugin,
  sqlQueryPlugin,
  redisCachePlugin,
  customCodePlugin,
  callSubflowPlugin,
  // Logic
  ifElsePlugin,
  forLoopPlugin,
  tryCatchPlugin,
  promiseAllPlugin,
  // Variables
  declarePlugin,
  transformPlugin,
  // Output
  returnResponsePlugin,
];
