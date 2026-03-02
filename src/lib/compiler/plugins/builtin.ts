/**
 * Built-in Node Plugins
 *
 * All built-in node code generators extracted from the compiler core.
 * Each generator follows the NodePlugin interface and can be overridden by external plugins.
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
// Type Inference Helpers
// ============================================================

/**
 * Infer output type from transform expression
 * Analyze common JavaScript expression patterns
 */
function inferTypeFromExpression(expr: string): string {
  const trimmed = expr.trim();

  // Array methods → array types
  if (/\.map\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.filter\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.flatMap\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.slice\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.concat\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.sort\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.reverse\s*\(/.test(trimmed)) return "unknown[]";
  if (/Array\.from\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.flat\s*\(/.test(trimmed)) return "unknown[]";
  if (/\.entries\s*\(/.test(trimmed)) return "[string, unknown][]";

  // Reduce → unknown (could be anything)
  if (/\.reduce\s*\(/.test(trimmed)) return "unknown";

  // Number-producing methods
  if (/\.length\b/.test(trimmed)) return "number";
  if (/\.indexOf\s*\(/.test(trimmed)) return "number";
  if (/\.findIndex\s*\(/.test(trimmed)) return "number";
  if (/parseInt\s*\(/.test(trimmed)) return "number";
  if (/parseFloat\s*\(/.test(trimmed)) return "number";
  if (/Number\s*\(/.test(trimmed)) return "number";
  if (/Math\./.test(trimmed)) return "number";

  // Boolean-producing patterns
  if (/\.includes\s*\(/.test(trimmed)) return "boolean";
  if (/\.some\s*\(/.test(trimmed)) return "boolean";
  if (/\.every\s*\(/.test(trimmed)) return "boolean";
  if (/\.has\s*\(/.test(trimmed)) return "boolean";
  if (/^!/.test(trimmed)) return "boolean";
  if (/===|!==|==|!=|>=|<=|>|<|&&|\|\|/.test(trimmed)) return "boolean";

  // String-producing patterns
  if (/\.join\s*\(/.test(trimmed)) return "string";
  if (/\.toString\s*\(/.test(trimmed)) return "string";
  if (/\.trim\s*\(/.test(trimmed)) return "string";
  if (/\.replace\s*\(/.test(trimmed)) return "string";
  if (/\.toLowerCase\s*\(/.test(trimmed)) return "string";
  if (/\.toUpperCase\s*\(/.test(trimmed)) return "string";
  if (/String\s*\(/.test(trimmed)) return "string";
  if (/JSON\.stringify\s*\(/.test(trimmed)) return "string";
  if (/`[^`]*`/.test(trimmed)) return "string";

  // Object-producing patterns
  if (/JSON\.parse\s*\(/.test(trimmed)) return "unknown";
  if (/Object\.keys\s*\(/.test(trimmed)) return "string[]";
  if (/Object\.values\s*\(/.test(trimmed)) return "unknown[]";
  if (/Object\.entries\s*\(/.test(trimmed)) return "[string, unknown][]";
  if (/Object\.assign\s*\(/.test(trimmed)) return "Record<string, unknown>";
  if (/Object\.fromEntries\s*\(/.test(trimmed)) return "Record<string, unknown>";
  if (/^\{/.test(trimmed)) return "Record<string, unknown>";
  if (/^\[/.test(trimmed)) return "unknown[]";
  if (/\.\.\.\s*\{\{/.test(trimmed)) return "Record<string, unknown>";

  // Find → single element or undefined
  if (/\.find\s*\(/.test(trimmed)) return "unknown | undefined";

  return "unknown";
}

/**
 * Infer the type of returnVariable from custom_code
 */
function inferTypeFromCode(code: string, returnVar: string): string {
  // Look for returnVar declaration
  const declMatch = code.match(
    new RegExp(`(?:const|let|var)\\s+${escapeRegex(returnVar)}\\s*(?::\\s*([^=]+?))?\\s*=\\s*(.+?)(?:;|$)`, "m")
  );
  if (declMatch) {
    // Has explicit type annotation
    const typeAnnotation = declMatch[1]?.trim();
    if (typeAnnotation) return typeAnnotation;

    // Infer from assignment expression
    const initializer = declMatch[2]?.trim();
    if (initializer) {
      if (/^\[/.test(initializer)) return "unknown[]";
      if (/^\{/.test(initializer)) return "Record<string, unknown>";
      if (/^["'`]/.test(initializer)) return "string";
      if (/^\d/.test(initializer)) return "number";
      if (/^(true|false)$/.test(initializer)) return "boolean";
      if (/^new Map/.test(initializer)) return "Map<unknown, unknown>";
      if (/^new Set/.test(initializer)) return "Set<unknown>";
      if (/\.map\s*\(/.test(initializer)) return "unknown[]";
      if (/\.filter\s*\(/.test(initializer)) return "unknown[]";
    }
  }
  return "unknown";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// Trigger Plugins (No-ops, handled in Platform Adapter)
// ============================================================

const httpWebhookPlugin: NodePlugin = {
  nodeType: TriggerType.HTTP_WEBHOOK,
  generate: () => { },
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
  generate: () => { },
  getOutputType: () => "{ triggeredAt: string }",
};

const manualPlugin: NodePlugin = {
  nodeType: TriggerType.MANUAL,
  generate: () => { },
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

/**
 * ⚠️ Dangerous API pattern list — used to generate warnings at compile time
 * custom_code writes user code line by line into the output, so risks must be flagged.
 */
const DANGEROUS_CODE_PATTERNS = [
  { pattern: /\bprocess\.exit\b/, desc: "process.exit() — terminates the Node.js process" },
  { pattern: /\bchild_process\b/, desc: "child_process — can execute arbitrary system commands" },
  { pattern: /\beval\s*\(/, desc: "eval() — dynamically executes arbitrary code" },
  { pattern: /\bnew\s+Function\s*\(/, desc: "new Function() — dynamically constructs functions" },
  { pattern: /\brequire\s*\(\s*['"]fs['"]/, desc: "require('fs') — file system access" },
  { pattern: /\bimport\s*\(\s*['"]fs['"]/, desc: "import('fs') — file system access" },
  { pattern: /\bfs\.\w*(unlink|rmdir|rm|writeFile)\b/, desc: "fs delete/write operations" },
];

const customCodePlugin: NodePlugin = {
  nodeType: ActionType.CUSTOM_CODE,

  generate(node, writer, context) {
    const params = node.params as CustomCodeParams;

    // Safety check: detect dangerous API calls
    const warnings: string[] = [];
    for (const { pattern, desc } of DANGEROUS_CODE_PATTERNS) {
      if (pattern.test(params.code)) {
        warnings.push(desc);
      }
    }
    if (warnings.length > 0) {
      writer.writeLine(`// ⚠️ SECURITY WARNING: This custom code uses the following dangerous APIs:`);
      for (const w of warnings) {
        writer.writeLine(`//   - ${w}`);
      }
      writer.writeLine(`// Please carefully review this code before deployment.`);
      // Also record to context warnings (if available)
      if (context && "addWarning" in context) {
        const addWarning = (context as { addWarning?: (msg: string) => void }).addWarning;
        addWarning?.(`[${node.id}] Custom code uses dangerous API: ${warnings.join(", ")}`);
      }
    }

    if (params.returnVariable) {
      writer.writeLine(`const custom_result = await (async () => {`);
    } else {
      writer.writeLine(`await (async () => {`);
    }

    writer.writeLine(`// Custom Code: ${node.label}`);
    const lines = params.code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // If the last line is a return statement and we have a returnVariable, strip the return keyword
      // if it conflicts. Actually, if user provided `returnVariable`, we just inject normal code.
      writer.writeLine(`  ${line}`);
    }

    // Auto-return the variable if specified, but keep it robust
    if (params.returnVariable) {
      writer.writeLine(`  if (typeof ${params.returnVariable} !== 'undefined') return ${params.returnVariable};`);
    }
    writer.writeLine(`})();`);

    if (params.returnVariable) {
      writer.writeLine(`flowState['${node.id}'] = custom_result;`);
    }
  },

  getOutputType(node) {
    const params = node.params as CustomCodeParams & { returnType?: string };
    // Users can specify return type via the returnType parameter
    if (params.returnType) return params.returnType;
    if (!params.returnVariable) return "void";
    // Try to infer type from code
    return inferTypeFromCode(params.code, params.returnVariable);
  },
};

const callSubflowPlugin: NodePlugin = {
  nodeType: ActionType.CALL_SUBFLOW,

  generate(node, writer, context) {
    const params = node.params as CallSubflowParams;

    // Static import: register in the import block at the top of the file
    const existing = context.imports.get(params.flowPath);
    if (existing) {
      existing.add(params.functionName);
    } else {
      context.imports.set(params.flowPath, new Set([params.functionName]));
    }

    // Resolve input mapping expressions
    const args = Object.entries(params.inputMapping)
      .map(([key, expr]) => {
        const resolved = context.resolveExpression(expr, node.id);
        return `${key}: ${resolved}`;
      })
      .join(", ");

    writer.writeLine(
      `flowState['${node.id}'] = await ${params.functionName}({ ${args} });`
    );
  },

  getOutputType(node) {
    const params = node.params as CallSubflowParams & { returnType?: string };
    if (params.returnType) return params.returnType;
    // Leverage TypeScript type inference: Awaited<ReturnType<typeof fn>>
    return `Awaited<ReturnType<typeof ${params.functionName}>>`;
  },
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

    // Dynamic scope variable name: avoid const shadowing in nested loops
    const scopeVar = `_scope_${sanitizedId}`;

    // Use scope isolation to prevent loop variables from polluting global flowState
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
      // Create local scope inside loop (unique variable name, no outer scope shadowing)
      writer.writeLine(
        `const ${scopeVar}: Record<string, unknown> = {};`
      );

      // Inject loop iteration item into scope
      writer.writeLine(
        `${scopeVar}['${node.id}'] = ${params.itemVariable};`
      );

      // Push scope: child node references to node.id will resolve to scopeVar
      context.pushScope(node.id, scopeVar);

      // Generate child nodes inside loop body
      const childEdges = context.ir.edges.filter(
        (e) => e.sourceNodeId === node.id && e.sourcePortId === "body"
      );
      for (const edge of childEdges) {
        const childNode = context.nodeMap.get(edge.targetNodeId);
        if (childNode) {
          context.generateChildNode(writer, childNode);
        }
      }

      // Pop scope
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

    const tryScopeVar = `_scope_${node.id.replace(/[^a-zA-Z0-9_]/g, "_")}_try`;
    const catchScopeVar = `_scope_${node.id.replace(/[^a-zA-Z0-9_]/g, "_")}_catch`;

    writer.write("try ").block(() => {
      // Create local scope for try block (unique variable name)
      writer.writeLine(
        `const ${tryScopeVar}: Record<string, unknown> = {};`
      );

      // Push scope: child node references to node.id will resolve to tryScopeVar
      context.pushScope(node.id, tryScopeVar);

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
      // Create local scope for catch block (unique variable name)
      writer.writeLine(
        `const ${catchScopeVar}: Record<string, unknown> = {};`
      );
      writer.writeLine(
        `flowState['${node.id}'] = { success: false, error: ${params.errorVariable} };`
      );

      // Push scope: child node references to node.id will resolve to catchScopeVar
      context.pushScope(node.id, catchScopeVar);

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

  getOutputType(node) {
    const params = node.params as TransformParams;
    return inferTypeFromExpression(params.expression);
  },
};

// ============================================================
// Output Plugins
// ============================================================

/**
 * Return Response Plugin
 * Note: This plugin requires platform adapter to provide generateResponse
 * Currently uses NextResponse.json directly (handled by compiler during integration)
 */
const returnResponsePlugin: NodePlugin = {
  nodeType: OutputType.RETURN_RESPONSE,

  generate(node, writer, context) {
    const params = node.params as ReturnResponseParams;
    const bodyExpr = context.resolveExpression(
      params.bodyExpression,
      node.id
    );

    // Delegate to platform adapter (via context.__platformResponse)
    // If no platform, fallback to NextResponse (backward compatible)
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
      // Fallback: use NextResponse directly (backward compatible)
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
// Export all built-in Plugins
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
