/**
 * Flow2Code AST 編譯器核心
 * 
 * 使用 ts-morph 將 FlowIR 轉換為原生 TypeScript 代碼。
 * 
 * 技術架構：
 * 1. 接收 FlowIR JSON
 * 2. 驗證 IR 結構
 * 3. 拓撲排序取得執行計畫
 * 4. 使用 ts-morph 建構 AST
 * 5. 輸出格式化的 TypeScript 代碼
 * 
 * 核心設計模式：flowState
 * - 在函數內部宣告 const flowState: Record<string, any> = {}
 * - 每個節點執行結果寫入 flowState[nodeId]
 * - 後續節點透過 flowState[depNodeId] 讀取依賴數據
 */

import { Project, SourceFile, CodeBlockWriter, StructureKind } from "ts-morph";
import type {
  FlowIR,
  FlowNode,
  NodeType,
  NodeId,
  HttpWebhookParams,
  CronJobParams,
  ManualTriggerParams,
  FetchApiParams,
  SqlQueryParams,
  RedisCacheParams,
  CustomCodeParams,
  IfElseParams,
  ForLoopParams,
  TryCatchParams,
  ReturnResponseParams,
  DeclareVariableParams,
  TransformParams,
} from "../ir/types";
import {
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
  NodeCategory,
} from "../ir/types";
import { validateFlowIR } from "../ir/validator";
import { topologicalSort, type ExecutionPlan } from "../ir/topological-sort";

// ============================================================
// 編譯結果
// ============================================================

export interface CompileResult {
  success: boolean;
  code?: string;
  errors?: string[];
  /** 生成的檔案路徑（相對路徑） */
  filePath?: string;
  /** 依賴套件報告 */
  dependencies?: DependencyReport;
  /** Source Map（nodeId ↔ line number 映射） */
  sourceMap?: SourceMap;
}

/** 依賴套件報告 */
export interface DependencyReport {
  /** 需要的所有套件 */
  all: string[];
  /** 缺少的套件（與 package.json 比對） */
  missing: string[];
  /** 安裝指令建議 */
  installCommand?: string;
}

/** Source Map：行號 ↔ 節點 ID 映射 */
export interface SourceMap {
  version: 1;
  generatedFile: string;
  /** nodeId → { startLine, endLine } */
  mappings: Record<string, { startLine: number; endLine: number }>;
}

// ============================================================
// 節點代碼生成器映射表 (Node Mapping Table)
// ============================================================

type NodeCodeGenerator = (
  node: FlowNode,
  writer: CodeBlockWriter,
  context: CompilerContext
) => void;

interface CompilerContext {
  ir: FlowIR;
  plan: ExecutionPlan;
  nodeMap: Map<NodeId, FlowNode>;
  /** 追蹤環境變數引用（用於生成 .env.example） */
  envVars: Set<string>;
  /** 追蹤需要的 imports */
  imports: Map<string, Set<string>>;
  /** 追蹤需要的 npm 套件 */
  requiredPackages: Set<string>;
  /** Source Map 行號追蹤 */
  sourceMapEntries: Map<NodeId, { startLine: number; endLine: number }>;
  /** 當前行數計數器（由 writer 更新） */
  currentLine: number;
}

/**
 * 節點類型 → npm 套件映射表
 * 編譯器根據使用的節點自動收集所需套件
 */
const NODE_PACKAGE_MAP: Partial<Record<NodeType, string[]>> = {
  [ActionType.FETCH_API]: [], // fetch is built-in in Node 18+
  [ActionType.SQL_QUERY]: [], // will be resolved dynamically based on ORM
  [ActionType.REDIS_CACHE]: ["ioredis"],
  [OutputType.RETURN_RESPONSE]: [], // Next.js built-in
};

/** SQL ORM → 套件映射 */
const ORM_PACKAGE_MAP: Record<string, string[]> = {
  drizzle: ["drizzle-orm"],
  prisma: ["@prisma/client"],
  raw: [],
};

// ============================================================
// 主編譯函式
// ============================================================

export function compile(ir: FlowIR): CompileResult {
  // 1. 驗證 IR
  const validation = validateFlowIR(ir);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors.map((e) => `[${e.code}] ${e.message}`),
    };
  }

  // 2. 拓撲排序
  let plan: ExecutionPlan;
  try {
    plan = topologicalSort(ir);
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  // 3. 建立上下文
  const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
  const context: CompilerContext = {
    ir,
    plan,
    nodeMap,
    envVars: new Set(),
    imports: new Map(),
    requiredPackages: new Set(),
    sourceMapEntries: new Map(),
    currentLine: 1,
  };

  // 4. 取得觸發器節點（決定生成模式）
  const trigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER)!;

  // 5. 使用 ts-morph 建構 AST
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("generated.ts", "");

  try {
    generateCode(sourceFile, trigger, context);
  } catch (err) {
    return {
      success: false,
      errors: [`AST 生成失敗: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // 6. 格式化並輸出
  sourceFile.formatText({
    indentSize: 2,
    convertTabsToSpaces: true,
  });

  const code = sourceFile.getFullText();
  const filePath = getOutputFilePath(trigger);

  // 收集節點所需套件
  collectRequiredPackages(ir, context);

  // 建構 Source Map（解析生成的代碼行號）
  const sourceMap = buildSourceMap(code, ir, filePath);

  // 建構依賴報告
  const dependencies: DependencyReport = {
    all: [...context.requiredPackages].sort(),
    missing: [...context.requiredPackages].sort(), // 預設全部視為 missing，由呼叫方比對
    installCommand: context.requiredPackages.size > 0
      ? `npm install ${[...context.requiredPackages].sort().join(" ")}`
      : undefined,
  };

  return {
    success: true,
    code,
    filePath,
    dependencies,
    sourceMap,
  };
}

// ============================================================
// 代碼生成主邏輯
// ============================================================

function generateCode(
  sourceFile: SourceFile,
  trigger: FlowNode,
  context: CompilerContext
): void {
  switch (trigger.nodeType) {
    case TriggerType.HTTP_WEBHOOK:
      generateHttpWebhook(sourceFile, trigger, context);
      break;
    case TriggerType.CRON_JOB:
      generateCronJob(sourceFile, trigger, context);
      break;
    case TriggerType.MANUAL:
      generateManualFunction(sourceFile, trigger, context);
      break;
    default:
      throw new Error(`不支援的觸發器類型: ${trigger.nodeType}`);
  }
}

// ============================================================
// HTTP Webhook 生成器
// ============================================================

function generateHttpWebhook(
  sourceFile: SourceFile,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const params = trigger.params as HttpWebhookParams;
  const isGetOrDelete = ["GET", "DELETE"].includes(params.method);

  // 加入 Next.js import（GET/DELETE 需要 NextRequest 才能存取 searchParams）
  sourceFile.addImportDeclaration({
    namedImports: isGetOrDelete
      ? ["NextRequest", "NextResponse"]
      : ["NextResponse"],
    moduleSpecifier: "next/server",
  });

  // 生成 export async function METHOD(req: NextRequest | Request)
  const funcDecl = sourceFile.addFunction({
    name: params.method,
    isAsync: true,
    isExported: true,
    parameters: [
      { name: "req", type: isGetOrDelete ? "NextRequest" : "Request" },
    ],
  });

  // 函式內部 — 最外層用 try/catch 包覆（Bug #4: 保證永遠回傳 JSON）
  funcDecl.addStatements((writer) => {
    writer.write("try ").block(() => {
      // flowState 初始化
      writer.writeLine("const flowState: Record<string, any> = {};");
      writer.blankLine();

      if (isGetOrDelete) {
        // ── GET / DELETE：解析 Query String，永遠不讀 body（Bug #2）──
        writer.writeLine("const searchParams = req.nextUrl.searchParams;");
        writer.writeLine(
          "const query = Object.fromEntries(searchParams.entries());"
        );
        writer.writeLine(
          `flowState['${trigger.id}'] = { query, url: req.url };`
        );
      } else if (
        params.parseBody &&
        ["POST", "PUT", "PATCH"].includes(params.method)
      ) {
        // ── POST / PUT / PATCH：解析 JSON body，加 try/catch 防 bad JSON（Bug #2）──
        writer.writeLine("let body: any;");
        writer.write("try ").block(() => {
          writer.writeLine("body = await req.json();");
        });
        writer.write(" catch ").block(() => {
          writer.writeLine(
            'return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });'
          );
        });
        writer.writeLine(
          `flowState['${trigger.id}'] = { body, url: req.url };`
        );
      } else {
        writer.writeLine(
          `flowState['${trigger.id}'] = { url: req.url };`
        );
      }
      writer.blankLine();

      // 按照拓撲排序生成後續節點的代碼
      generateNodeChain(writer, trigger.id, context);
    });

    // ── 全域 catch：保證所有非預期錯誤都回傳 JSON（Bug #4）──
    writer.write(" catch (error) ").block(() => {
      writer.writeLine('console.error("Workflow failed:", error);');
      writer.writeLine(
        'return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });'
      );
    });
  });
}

// ============================================================
// Cron Job 生成器
// ============================================================

function generateCronJob(
  sourceFile: SourceFile,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const params = trigger.params as CronJobParams;

  // 加入 schedule 註釋
  sourceFile.addStatements(
    `// @schedule ${params.schedule}`
  );

  const funcDecl = sourceFile.addFunction({
    name: params.functionName,
    isAsync: true,
    isExported: true,
  });

  funcDecl.addStatements((writer) => {
    writer.writeLine("const flowState: Record<string, any> = {};");
    writer.writeLine(`flowState['${trigger.id}'] = { triggeredAt: new Date().toISOString() };`);
    writer.blankLine();
    generateNodeChain(writer, trigger.id, context);
  });
}

// ============================================================
// Manual Function 生成器
// ============================================================

function generateManualFunction(
  sourceFile: SourceFile,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const params = trigger.params as ManualTriggerParams;

  const funcDecl = sourceFile.addFunction({
    name: params.functionName,
    isAsync: true,
    isExported: true,
    parameters: params.args.map((arg) => ({
      name: arg.name,
      type: arg.type,
    })),
  });

  funcDecl.addStatements((writer) => {
    writer.writeLine("const flowState: Record<string, any> = {};");
    if (params.args.length > 0) {
      const argsObj = params.args.map((a) => a.name).join(", ");
      writer.writeLine(`flowState['${trigger.id}'] = { ${argsObj} };`);
    }
    writer.blankLine();
    generateNodeChain(writer, trigger.id, context);
  });
}

// ============================================================
// 節點鏈生成器（按拓撲排序處理所有非觸發器節點）
// ============================================================

function generateNodeChain(
  writer: CodeBlockWriter,
  triggerId: NodeId,
  context: CompilerContext
): void {
  const { plan, nodeMap, ir } = context;

  // 跳過觸發器，按順序處理其餘步驟
  for (const step of plan.steps) {
    const nonTriggerNodes = step.nodeIds.filter((id) => id !== triggerId);
    if (nonTriggerNodes.length === 0) continue;

    if (step.concurrent && nonTriggerNodes.length > 1) {
      // 並發節點 → Promise.all
      generateConcurrentNodes(writer, nonTriggerNodes, context);
    } else {
      // 順序執行
      for (const nodeId of nonTriggerNodes) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        generateSingleNode(writer, node, context);
        writer.blankLine();
      }
    }
  }
}

// ============================================================
// 並發節點生成器 (Promise.all)
// ============================================================

function generateConcurrentNodes(
  writer: CodeBlockWriter,
  nodeIds: NodeId[],
  context: CompilerContext
): void {
  const { nodeMap } = context;

  writer.writeLine("// --- Concurrent Execution ---");
  
  // 先為每個節點生成 async 函式
  const taskNames: string[] = [];
  for (const nodeId of nodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const taskName = `task_${sanitizeId(nodeId)}`;
    taskNames.push(taskName);

    writer.write(`const ${taskName} = async () => `).block(() => {
      generateNodeBody(writer, node, context);
    });
    writer.writeLine(";");
  }

  // Promise.all
  writer.writeLine(
    `const [${taskNames.map((_, i) => `r${i}`).join(", ")}] = await Promise.all([${taskNames.map((t) => `${t}()`).join(", ")}]);`
  );

  // 將結果寫入 flowState
  nodeIds.forEach((nodeId, i) => {
    writer.writeLine(`flowState['${nodeId}'] = r${i};`);
  });

  writer.blankLine();
}

// ============================================================
// 單節點代碼生成器 (Dispatcher)
// ============================================================

function generateSingleNode(
  writer: CodeBlockWriter,
  node: FlowNode,
  context: CompilerContext
): void {
  writer.writeLine(`// --- ${node.label} (${node.nodeType}) ---`);
  generateNodeBody(writer, node, context);
}

function generateNodeBody(
  writer: CodeBlockWriter,
  node: FlowNode,
  context: CompilerContext
): void {
  const generator = nodeGenerators[node.nodeType];
  if (generator) {
    generator(node, writer, context);
  } else {
    writer.writeLine(`// TODO: 尚未實作節點類型 "${node.nodeType}"`);
    writer.writeLine(`flowState['${node.id}'] = undefined;`);
  }
}

// ============================================================
// 節點代碼生成器映射表
// ============================================================

const nodeGenerators: Record<NodeType, NodeCodeGenerator> = {
  // ── Triggers（已在上層處理） ──
  [TriggerType.HTTP_WEBHOOK]: () => {},
  [TriggerType.CRON_JOB]: () => {},
  [TriggerType.MANUAL]: () => {},

  // ── Fetch API ──
  [ActionType.FETCH_API]: (node, writer, context) => {
    const params = node.params as FetchApiParams;
    const url = resolveEnvVars(params.url, context);

    writer.write("try ").block(() => {
      // 構建 fetch 選項
      const hasBody = params.body && ["POST", "PUT", "PATCH"].includes(params.method);
      
      writer.writeLine(`const response = await fetch(${url}, {`);
      writer.writeLine(`  method: "${params.method}",`);
      
      if (params.headers && Object.keys(params.headers).length > 0) {
        writer.writeLine(`  headers: ${JSON.stringify(params.headers)},`);
      } else if (hasBody) {
        writer.writeLine(`  headers: { "Content-Type": "application/json" },`);
      }
      
      if (hasBody) {
        const bodyExpr = resolveExpression(params.body!, context);
        writer.writeLine(`  body: JSON.stringify(${bodyExpr}),`);
      }
      
      writer.writeLine("});");
      writer.blankLine();

      // ── Bug #3: 檢查 HTTP 回應狀態，不盲目信任 response.ok ──
      writer.write("if (!response.ok) ").block(() => {
        writer.writeLine(
          `throw new Error(\`${node.label} failed: HTTP \${response.status} \${response.statusText}\`);`
        );
      });
      writer.blankLine();

      if (params.parseJson) {
        writer.writeLine(`const data = await response.json();`);
        writer.writeLine(`flowState['${node.id}'] = data;`);
      } else {
        writer.writeLine(`flowState['${node.id}'] = response;`);
      }
    });
    writer.write(" catch (fetchError) ").block(() => {
      writer.writeLine(`console.error("Fetch failed for ${node.label}:", fetchError);`);
      writer.writeLine(`throw fetchError;`);
    });
  },

  // ── SQL Query ──
  [ActionType.SQL_QUERY]: (node, writer, _context) => {
    const params = node.params as SqlQueryParams;

    switch (params.orm) {
      case "drizzle":
        writer.writeLine(`// Drizzle ORM Query`);
        writer.writeLine(`const result = await db.execute(sql\`${params.query}\`);`);
        writer.writeLine(`flowState['${node.id}'] = result;`);
        break;
      case "prisma":
        writer.writeLine(`// Prisma Query`);
        writer.writeLine(`const result = await prisma.$queryRaw\`${params.query}\`;`);
        writer.writeLine(`flowState['${node.id}'] = result;`);
        break;
      case "raw":
      default:
        writer.writeLine(`// Raw SQL Query`);
        writer.writeLine(`const result = await db.query(\`${params.query}\`);`);
        writer.writeLine(`flowState['${node.id}'] = result;`);
        break;
    }
  },

  // ── Redis Cache ──
  [ActionType.REDIS_CACHE]: (node, writer, _context) => {
    const params = node.params as RedisCacheParams;
    
    switch (params.operation) {
      case "get":
        writer.writeLine(`flowState['${node.id}'] = await redis.get("${params.key}");`);
        break;
      case "set":
        if (params.ttl) {
          writer.writeLine(`await redis.set("${params.key}", ${params.value ?? "null"}, "EX", ${params.ttl});`);
        } else {
          writer.writeLine(`await redis.set("${params.key}", ${params.value ?? "null"});`);
        }
        writer.writeLine(`flowState['${node.id}'] = true;`);
        break;
      case "del":
        writer.writeLine(`await redis.del("${params.key}");`);
        writer.writeLine(`flowState['${node.id}'] = true;`);
        break;
    }
  },

  // ── Custom Code ──
  [ActionType.CUSTOM_CODE]: (node, writer, _context) => {
    const params = node.params as CustomCodeParams;
    
    // 直接插入用戶的 TypeScript 代碼
    writer.writeLine(`// Custom Code: ${node.label}`);
    for (const line of params.code.split("\n")) {
      writer.writeLine(line);
    }
    if (params.returnVariable) {
      writer.writeLine(`flowState['${node.id}'] = ${params.returnVariable};`);
    }
  },

  // ── If/Else ──
  [LogicType.IF_ELSE]: (node, writer, context) => {
    const params = node.params as IfElseParams;
    const { ir, nodeMap } = context;

    // 找到 true 和 false 分支的子節點
    const trueEdges = ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "true"
    );
    const falseEdges = ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "false"
    );

    const conditionExpr = resolveExpression(params.condition, context);

    writer.write(`if (${conditionExpr}) `).block(() => {
      writer.writeLine(`flowState['${node.id}'] = true;`);
      // 生成 true 分支子節點
      for (const edge of trueEdges) {
        const childNode = nodeMap.get(edge.targetNodeId);
        if (childNode) {
          generateNodeBody(writer, childNode, context);
        }
      }
    });
    
    if (falseEdges.length > 0) {
      writer.write(" else ").block(() => {
        writer.writeLine(`flowState['${node.id}'] = false;`);
        for (const edge of falseEdges) {
          const childNode = nodeMap.get(edge.targetNodeId);
          if (childNode) {
            generateNodeBody(writer, childNode, context);
          }
        }
      });
    }
  },

  // ── For Loop ──
  [LogicType.FOR_LOOP]: (node, writer, context) => {
    const params = node.params as ForLoopParams;
    const iterableExpr = resolveExpression(params.iterableExpression, context);

    writer.writeLine(`const ${node.id}_results: any[] = [];`);
    
    if (params.indexVariable) {
      writer.write(
        `for (const [${params.indexVariable}, ${params.itemVariable}] of (${iterableExpr}).entries()) `
      );
    } else {
      writer.write(`for (const ${params.itemVariable} of ${iterableExpr}) `);
    }
    
    writer.block(() => {
      writer.writeLine(`${node.id}_results.push(${params.itemVariable});`);
    });
    
    writer.writeLine(`flowState['${node.id}'] = ${node.id}_results;`);
  },

  // ── Try/Catch ──
  [LogicType.TRY_CATCH]: (node, writer, context) => {
    const params = node.params as TryCatchParams;
    const { ir, nodeMap } = context;

    // 找到 success 和 error 分支
    const successEdges = ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "success"
    );
    const errorEdges = ir.edges.filter(
      (e) => e.sourceNodeId === node.id && e.sourcePortId === "error"
    );

    writer.write("try ").block(() => {
      for (const edge of successEdges) {
        const childNode = nodeMap.get(edge.targetNodeId);
        if (childNode) {
          generateNodeBody(writer, childNode, context);
        }
      }
      writer.writeLine(`flowState['${node.id}'] = { success: true };`);
    });
    writer.write(` catch (${params.errorVariable}) `).block(() => {
      writer.writeLine(
        `console.error("Error in ${node.label}:", ${params.errorVariable});`
      );
      writer.writeLine(`flowState['${node.id}'] = { success: false, error: ${params.errorVariable} };`);
      for (const edge of errorEdges) {
        const childNode = nodeMap.get(edge.targetNodeId);
        if (childNode) {
          generateNodeBody(writer, childNode, context);
        }
      }
    });
  },

  // ── Promise.all ──
  [LogicType.PROMISE_ALL]: (node, writer, _context) => {
    // Promise.all 的邏輯在 generateConcurrentNodes 中處理
    writer.writeLine(`// Promise.all handled by concurrent execution`);
    writer.writeLine(`flowState['${node.id}'] = undefined; // populated by concurrent handler`);
  },

  // ── Declare Variable ──
  [VariableType.DECLARE]: (node, writer, _context) => {
    const params = node.params as DeclareVariableParams;
    const keyword = params.isConst ? "const" : "let";
    const initialValue = params.initialValue ?? "undefined";
    
    writer.writeLine(`${keyword} ${params.name} = ${initialValue};`);
    writer.writeLine(`flowState['${node.id}'] = ${params.name};`);
  },

  // ── Transform ──
  [VariableType.TRANSFORM]: (node, writer, context) => {
    const params = node.params as TransformParams;
    const expr = resolveExpression(params.expression, context, node.id);

    writer.writeLine(`flowState['${node.id}'] = ${expr};`);
  },

  // ── Return Response ──
  [OutputType.RETURN_RESPONSE]: (node, writer, context) => {
    const params = node.params as ReturnResponseParams;
    const bodyExpr = resolveExpression(params.bodyExpression, context, node.id);

    if (params.headers && Object.keys(params.headers).length > 0) {
      writer.writeLine(
        `return NextResponse.json(${bodyExpr}, { status: ${params.statusCode}, headers: ${JSON.stringify(params.headers)} });`
      );
    } else {
      writer.writeLine(
        `return NextResponse.json(${bodyExpr}, { status: ${params.statusCode} });`
      );
    }
  },
};

// ============================================================
// 輔助函式
// ============================================================

/**
 * 將節點 ID 轉為合法的 JS 變數名片段
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * 解析表達式中的 flowState 引用
 * 支援格式：
 *   {{nodeId}}           → flowState['nodeId']
 *   {{nodeId.path}}      → flowState['nodeId'].path
 *   {{$input}}           → 自動解析當前節點第一個非觸發器上游節點的 flowState
 *   {{$input.path}}      → 同上，帶子路徑
 *   {{$trigger}}         → 自動解析觸發器節點的 flowState
 *   {{$trigger.body}}    → flowState['triggerId'].body
 */
function resolveExpression(
  expr: string,
  context: CompilerContext,
  currentNodeId?: NodeId
): string {
  return expr.replace(/\{\{(\$?\w+)(\.[\w.[\]]+)?\}\}/g, (_match, ref, path) => {
    // ── 特殊變數 $input：解析上一個連入的非觸發器節點 ──
    if (ref === "$input" && currentNodeId) {
      const incoming = context.ir.edges.filter(
        (e) => e.targetNodeId === currentNodeId
      );
      // 優先選非觸發器的上游節點
      const dataSource =
        incoming.find((e) => {
          const src = context.nodeMap.get(e.sourceNodeId);
          return src && src.category !== NodeCategory.TRIGGER;
        }) || incoming[0];

      if (dataSource) {
        const base = `flowState['${dataSource.sourceNodeId}']`;
        return path ? `${base}${path}` : base;
      }
      return '{ error: "No input connected" }';
    }

    // ── 特殊變數 $trigger：解析觸發器節點 ──
    if (ref === "$trigger") {
      const trigger = context.ir.nodes.find(
        (n) => n.category === NodeCategory.TRIGGER
      );
      if (trigger) {
        const base = `flowState['${trigger.id}']`;
        return path ? `${base}${path}` : base;
      }
      return "undefined";
    }

    // ── 一般參照：{{nodeId}} → flowState['nodeId'] ──
    if (path) {
      return `flowState['${ref}']${path}`;
    }
    return `flowState['${ref}']`;
  });
}

/**
 * 解析 URL 中的環境變數引用
 * 支援格式：${ENV_VAR}
 */
function resolveEnvVars(url: string, context: CompilerContext): string {
  const hasEnvVar = /\$\{(\w+)\}/.test(url);
  if (hasEnvVar) {
    return (
      "`" +
      url.replace(/\$\{(\w+)\}/g, (_match, varName) => {
        context.envVars.add(varName);
        return "${process.env." + varName + "}";
      }) +
      "`"
    );
  }
  return `"${url}"`;
}

/**
 * 收集節點所需的 npm 套件
 */
function collectRequiredPackages(ir: FlowIR, context: CompilerContext): void {
  for (const node of ir.nodes) {
    // 靜態映射
    const packages = NODE_PACKAGE_MAP[node.nodeType];
    if (packages) {
      packages.forEach((pkg) => context.requiredPackages.add(pkg));
    }

    // SQL ORM 動態解析
    if (node.nodeType === ActionType.SQL_QUERY) {
      const params = node.params as SqlQueryParams;
      const ormPackages = ORM_PACKAGE_MAP[params.orm] ?? [];
      ormPackages.forEach((pkg) => context.requiredPackages.add(pkg));
    }

    // HTTP Webhook 需要 next/server
    if (node.nodeType === TriggerType.HTTP_WEBHOOK) {
      // next is a peer dependency, always required
    }
  }
}

/**
 * 建構 Source Map：解析生成的代碼，映射註解標記到行號
 * 
 * 利用生成代碼中的 "// --- NodeLabel (nodeType) ---" 標記
 * 定位每個節點的開始與結束行。
 */
function buildSourceMap(
  code: string,
  ir: FlowIR,
  filePath: string
): SourceMap {
  const lines = code.split("\n");
  const mappings: Record<string, { startLine: number; endLine: number }> = {};

  // 建立 label → nodeId 映射
  const labelToNode = new Map<string, FlowNode>();
  for (const node of ir.nodes) {
    labelToNode.set(node.label, node);
  }

  // 掃描程式碼中的節點標記
  const nodeMarkerRegex = /^[\s]*\/\/ --- (.+?) \((.+?)\) ---$/;
  
  let currentNodeId: string | null = null;
  let currentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    const match = lines[i].match(nodeMarkerRegex);

    if (match) {
      // 如果有前一個節點在追蹤，結束它
      if (currentNodeId) {
        mappings[currentNodeId] = {
          startLine: currentStartLine,
          endLine: lineNum - 1,
        };
      }

      // 開始追蹤新節點
      const [, label, nodeType] = match;
      const node = ir.nodes.find(
        (n) => n.label === label && n.nodeType === nodeType
      );
      if (node) {
        currentNodeId = node.id;
        currentStartLine = lineNum;
      } else {
        currentNodeId = null;
      }
    }
  }

  // 結束最後一個節點
  if (currentNodeId) {
    mappings[currentNodeId] = {
      startLine: currentStartLine,
      endLine: lines.length,
    };
  }

  // 為觸發器節點標記（通常是整個函式）
  const trigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER);
  if (trigger && !mappings[trigger.id]) {
    // 觸發器通常從 export async function 開始
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("export async function") || lines[i].includes("@schedule")) {
        mappings[trigger.id] = { startLine: i + 1, endLine: lines.length };
        break;
      }
    }
  }

  return {
    version: 1,
    generatedFile: filePath,
    mappings,
  };
}

/**
 * 給定行號，反查對應的 nodeId
 */
export function traceLineToNode(
  sourceMap: SourceMap,
  line: number
): { nodeId: string; startLine: number; endLine: number } | null {
  for (const [nodeId, range] of Object.entries(sourceMap.mappings)) {
    if (line >= range.startLine && line <= range.endLine) {
      return { nodeId, ...range };
    }
  }
  return null;
}

/**
 * 取得輸出檔案路徑
 */
function getOutputFilePath(trigger: FlowNode): string {
  if (trigger.nodeType === TriggerType.HTTP_WEBHOOK) {
    const params = trigger.params as HttpWebhookParams;
    // 將路由路徑轉為 Next.js App Router 的檔案路徑
    const routePath = params.routePath.replace(/^\//, "");
    return `src/app/${routePath}/route.ts`;
  }
  if (trigger.nodeType === TriggerType.CRON_JOB) {
    const params = trigger.params as CronJobParams;
    return `src/lib/cron/${params.functionName}.ts`;
  }
  if (trigger.nodeType === TriggerType.MANUAL) {
    const params = trigger.params as ManualTriggerParams;
    return `src/lib/functions/${params.functionName}.ts`;
  }
  return "src/generated/flow.ts";
}
