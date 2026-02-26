/**
 * Flow2Code AST 編譯器核心 (v2)
 *
 * 架構重構：
 *   1. Platform Adapter — 解耦 Next.js，支援 Express / Cloudflare Workers
 *   2. Plugin System — 節點生成邏輯可外部註冊，取代 hardcoded nodeGenerators
 *   3. Expression Parser — 使用 Recursive Descent Parser 取代 Regex
 *   4. Type Inference — 生成具型別的 FlowState interface，取代 Record<string, any>
 *   5. Scoped State — 迴圈/try-catch 使用局部作用域，避免變數覆蓋
 *
 * 公開 API（向後相容）：
 *   - compile(ir)                → CompileResult（預設 nextjs 平台）
 *   - compile(ir, { platform })  → CompileResult（指定平台）
 *   - traceLineToNode(sourceMap, line) → 行號反查節點
 */

import { Project, SourceFile, CodeBlockWriter } from "ts-morph";
import type {
  FlowIR,
  FlowNode,
  NodeType,
  NodeId,
  HttpWebhookParams,
  CronJobParams,
  ManualTriggerParams,
} from "../ir/types";
import {
  TriggerType,
  ActionType,
  NodeCategory,
} from "../ir/types";
import { validateFlowIR } from "../ir/validator";
import { topologicalSort, type ExecutionPlan } from "../ir/topological-sort";

// ── 新模組 ──
import { parseExpression, type ExpressionContext, type ScopeEntry } from "./expression-parser";
import {
  type PlatformAdapter,
  type PlatformName,
  getPlatform,
} from "./platforms/index";
import {
  type NodePlugin,
  type PluginContext,
  getPlugin,
  hasPlugin,
  registerPlugins,
  getAllPlugins,
} from "./plugins/index";
import { builtinPlugins } from "./plugins/builtin";
import { inferFlowStateTypes } from "./type-inference";
import { buildSymbolTable, type SymbolTable } from "./symbol-table";

// ── 初始化內建 Plugins（只執行一次） ──
let _builtinRegistered = false;
function ensureBuiltinPlugins(): void {
  if (!_builtinRegistered) {
    registerPlugins(builtinPlugins);
    _builtinRegistered = true;
  }
}

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
// 編譯選項
// ============================================================

export interface CompileOptions {
  /** 目標平台（預設 "nextjs"） */
  platform?: PlatformName;
  /** 額外的 Node Plugins */
  plugins?: NodePlugin[];
}

// ============================================================
// 內部編譯器上下文
// ============================================================

interface CompilerContext {
  ir: FlowIR;
  plan: ExecutionPlan;
  nodeMap: Map<NodeId, FlowNode>;
  envVars: Set<string>;
  imports: Map<string, Set<string>>;
  requiredPackages: Set<string>;
  sourceMapEntries: Map<NodeId, { startLine: number; endLine: number }>;
  currentLine: number;
  platform: PlatformAdapter;
  symbolTable: SymbolTable;
  /** Scope Stack：追蹤目前所處的局部作用域（for-loop / try-catch 等） */
  scopeStack: ScopeEntry[];
  /** 在子區塊（if/else、for-loop body、try/catch）內生成的節點 ID */
  childBlockNodeIds: Set<NodeId>;
  /** 是否啟用 DAG 並發排程（取代階層式 Promise.all） */
  dagMode: boolean;
  /** 不應使用 Symbol Table 別名的節點 ID（子區塊 + DAG promise 內節點） */
  symbolTableExclusions: Set<NodeId>;
}

/**
 * 節點類型 → npm 套件映射表（fallback，Plugin 優先）
 */
const NODE_PACKAGE_MAP: Partial<Record<NodeType, string[]>> = {
  [ActionType.FETCH_API]: [],
  [ActionType.SQL_QUERY]: [],
  [ActionType.REDIS_CACHE]: ["ioredis"],
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

export function compile(ir: FlowIR, options?: CompileOptions): CompileResult {
  ensureBuiltinPlugins();

  // 註冊額外 Plugins
  if (options?.plugins) {
    registerPlugins(options.plugins);
  }

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
  const platformName = options?.platform ?? "nextjs";
  const platform = getPlatform(platformName);
  const symbolTable = buildSymbolTable(ir);

  const context: CompilerContext = {
    ir,
    plan,
    nodeMap,
    envVars: new Set(),
    imports: new Map(),
    requiredPackages: new Set(),
    sourceMapEntries: new Map(),
    currentLine: 1,
    platform,
    symbolTable,
    scopeStack: [],
    childBlockNodeIds: new Set(),
    dagMode: false,
    symbolTableExclusions: new Set(),
  };

  // 偵測並發機會：若執行計畫有任何並發步驟，啟用 DAG 排程
  const trigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER)!;
  const hasConcurrency = plan.steps.some(
    (s) => s.concurrent && s.nodeIds.filter((id) => id !== trigger.id).length > 1
  );
  if (hasConcurrency) {
    context.dagMode = true;
    // DAG 模式下，所有非 trigger 節點的 Symbol Table 別名不在外層可見
    for (const node of ir.nodes) {
      if (node.category !== NodeCategory.TRIGGER) {
        context.symbolTableExclusions.add(node.id);
      }
    }
  }

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
  const filePath = platform.getOutputFilePath(trigger);

  // 收集依賴
  collectRequiredPackages(ir, context);

  // 建構 Source Map
  const sourceMap = buildSourceMap(code, ir, filePath);

  const dependencies: DependencyReport = {
    all: [...context.requiredPackages].sort(),
    missing: [...context.requiredPackages].sort(),
    installCommand:
      context.requiredPackages.size > 0
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
  const { platform } = context;

  // 生成 imports
  platform.generateImports(sourceFile, trigger, {
    ir: context.ir,
    nodeMap: context.nodeMap,
    envVars: context.envVars,
    imports: context.imports,
  });

  // 生成函式（由 platform adapter 決定結構）
  platform.generateFunction(
    sourceFile,
    trigger,
    {
      ir: context.ir,
      nodeMap: context.nodeMap,
      envVars: context.envVars,
      imports: context.imports,
    },
    (writer: CodeBlockWriter) => {
      generateFunctionBody(writer, trigger, context);
    }
  );
}

/**
 * 生成函式內部代碼（flowState + 觸發器初始化 + 節點鏈）
 */
function generateFunctionBody(
  writer: CodeBlockWriter,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const { ir } = context;

  // ── 型別安全的 flowState 宣告 ──
  const typeInfo = inferFlowStateTypes(ir);
  writer.writeLine(typeInfo.interfaceCode);
  writer.writeLine("const flowState: Partial<FlowState> = {};");
  writer.blankLine();

  // ── 觸發器初始化（使用命名變數） ──
  generateTriggerInit(writer, trigger, context);
  writer.blankLine();

  // ── 按拓撲排序生成後續節點 ──
  generateNodeChain(writer, trigger.id, context);
}

/**
 * 根據觸發器類型初始化 flowState（使用命名變數）
 */
function generateTriggerInit(
  writer: CodeBlockWriter,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const varName = context.symbolTable.getVarName(trigger.id);

  switch (trigger.nodeType) {
    case TriggerType.HTTP_WEBHOOK: {
      const params = trigger.params as HttpWebhookParams;
      const isGetOrDelete = ["GET", "DELETE"].includes(params.method);

      if (isGetOrDelete) {
        writer.writeLine("const searchParams = req.nextUrl.searchParams;");
        writer.writeLine(
          "const query = Object.fromEntries(searchParams.entries());"
        );
        writer.writeLine(
          `const ${varName} = { query, url: req.url };`
        );
        writer.writeLine(
          `flowState['${trigger.id}'] = ${varName};`
        );
      } else if (
        params.parseBody &&
        ["POST", "PUT", "PATCH"].includes(params.method)
      ) {
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
          `const ${varName} = { body, url: req.url };`
        );
        writer.writeLine(
          `flowState['${trigger.id}'] = ${varName};`
        );
      } else {
        writer.writeLine(
          `const ${varName} = { url: req.url };`
        );
        writer.writeLine(
          `flowState['${trigger.id}'] = ${varName};`
        );
      }
      break;
    }
    case TriggerType.CRON_JOB: {
      writer.writeLine(
        `const ${varName} = { triggeredAt: new Date().toISOString() };`
      );
      writer.writeLine(
        `flowState['${trigger.id}'] = ${varName};`
      );
      break;
    }
    case TriggerType.MANUAL: {
      const params = trigger.params as ManualTriggerParams;
      if (params.args.length > 0) {
        const argsObj = params.args.map((a) => a.name).join(", ");
        writer.writeLine(`const ${varName} = { ${argsObj} };`);
        writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
      }
      break;
    }
  }
}

// ============================================================
// ============================================================
// 節點鏈生成器（調度器）
// ============================================================

function generateNodeChain(
  writer: CodeBlockWriter,
  triggerId: NodeId,
  context: CompilerContext
): void {
  if (context.dagMode) {
    generateNodeChainDAG(writer, triggerId, context);
  } else {
    generateNodeChainSequential(writer, triggerId, context);
  }
}

// ============================================================
// 循序模式（無並發機會時使用）
// ============================================================

function generateNodeChainSequential(
  writer: CodeBlockWriter,
  triggerId: NodeId,
  context: CompilerContext
): void {
  const { plan, nodeMap } = context;

  for (const step of plan.steps) {
    // 過濾 trigger 和已在子區塊生成的節點
    const activeNodes = step.nodeIds.filter(
      (id) => id !== triggerId && !context.childBlockNodeIds.has(id)
    );
    if (activeNodes.length === 0) continue;

    if (step.concurrent && activeNodes.length > 1) {
      generateConcurrentNodes(writer, activeNodes, context);
    } else {
      for (const nodeId of activeNodes) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        generateSingleNode(writer, node, context);
        writer.blankLine();
      }
    }
  }
}

// ============================================================
// DAG 並發模式（per-node promise，只 await 直接上游）
// ============================================================

/**
 * 將子區塊節點的依賴解析到其宿主 DAG 節點。
 * 例如 if_else → [true: fetch_child]，下游依賴 fetch_child 時
 * 實際應 await if_else 的 promise。
 */
function resolveToDAGNodes(
  depId: NodeId,
  triggerId: NodeId,
  context: CompilerContext,
  visited: Set<NodeId> = new Set()
): NodeId[] {
  if (visited.has(depId) || depId === triggerId) return [];
  visited.add(depId);

  // 如果 dep 不是子區塊節點，它就是 DAG 節點（有自己的 promise）
  if (!context.childBlockNodeIds.has(depId)) return [depId];

  // 子區塊節點：往上游遞迴找到宿主 DAG 節點
  const parentDeps = context.plan.dependencies.get(depId) ?? new Set();
  const result: NodeId[] = [];
  for (const pd of parentDeps) {
    result.push(...resolveToDAGNodes(pd, triggerId, context, visited));
  }
  return result;
}

function generateNodeChainDAG(
  writer: CodeBlockWriter,
  triggerId: NodeId,
  context: CompilerContext
): void {
  const { plan, nodeMap } = context;

  // 按拓撲序收集所有非 trigger 節點
  const allNodeIds = plan.sortedNodeIds.filter((id) => id !== triggerId);

  // 分離 output 節點（它們含 return，不能包在 promise 裡）
  const outputNodeIds: NodeId[] = [];
  const dagNodeIds: NodeId[] = [];

  for (const id of allNodeIds) {
    // 子區塊節點跳過（由父節點 plugin 內部生成）
    if (context.childBlockNodeIds.has(id)) continue;
    const node = nodeMap.get(id);
    if (!node) continue;
    if (node.category === NodeCategory.OUTPUT) {
      outputNodeIds.push(id);
    } else {
      dagNodeIds.push(id);
    }
  }

  if (dagNodeIds.length > 0) {
    writer.writeLine("// --- DAG Concurrent Execution ---");
    writer.blankLine();
  }

  // 為每個 worker 節點生成 promise IIFE
  for (const nodeId of dagNodeIds) {
    const node = nodeMap.get(nodeId)!;

    // 解析直接上游依賴（子區塊 dep 會被映射到其宿主 DAG 節點）
    const rawDeps = [...(plan.dependencies.get(nodeId) ?? [])];
    const resolvedDeps = new Set<NodeId>();
    for (const depId of rawDeps) {
      for (const dagDep of resolveToDAGNodes(depId, triggerId, context)) {
        resolvedDeps.add(dagDep);
      }
    }
    // 排除自己（防止自環）
    resolvedDeps.delete(nodeId);

    const promiseVar = `p_${sanitizeId(nodeId)}`;
    writer.write(`const ${promiseVar} = (async () => `).block(() => {
      // await 所有直接上游 promise
      for (const depId of resolvedDeps) {
        writer.writeLine(`await p_${sanitizeId(depId)};`);
      }
      writer.writeLine(`// --- ${node.label} (${node.nodeType}) ---`);
      generateNodeBody(writer, node, context);
    });
    writer.writeLine(`)();`);
    writer.blankLine();
  }

  // Output 節點：循序 await 上游 promise，然後執行（含 return）
  for (const nodeId of outputNodeIds) {
    const node = nodeMap.get(nodeId)!;
    const rawDeps = [...(plan.dependencies.get(nodeId) ?? [])];
    const resolvedDeps = new Set<NodeId>();
    for (const depId of rawDeps) {
      for (const dagDep of resolveToDAGNodes(depId, triggerId, context)) {
        resolvedDeps.add(dagDep);
      }
    }

    for (const depId of resolvedDeps) {
      writer.writeLine(`await p_${sanitizeId(depId)};`);
    }
    writer.writeLine(`// --- ${node.label} (${node.nodeType}) ---`);
    generateNodeBody(writer, node, context);
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
  // 過濾已在子區塊生成的節點
  const activeNodeIds = nodeIds.filter((id) => !context.childBlockNodeIds.has(id));
  if (activeNodeIds.length === 0) return;

  // 只剩一個節點時無需 Promise.all
  if (activeNodeIds.length === 1) {
    const node = nodeMap.get(activeNodeIds[0]);
    if (node) {
      generateSingleNode(writer, node, context);
      writer.blankLine();
    }
    return;
  }

  writer.writeLine("// --- Concurrent Execution ---");

  const taskNames: string[] = [];
  for (const nodeId of activeNodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const taskName = `task_${sanitizeId(nodeId)}`;
    taskNames.push(taskName);

    writer.write(`const ${taskName} = async () => `).block(() => {
      generateNodeBody(writer, node, context);
    });
    writer.writeLine(";");
  }

  writer.writeLine(
    `const [${taskNames.map((_, i) => `r${i}`).join(", ")}] = await Promise.all([${taskNames.map((t) => `${t}()`).join(", ")}]);`
  );

  activeNodeIds.forEach((nodeId, i) => {
    writer.writeLine(`flowState['${nodeId}'] = r${i};`);
  });

  // 生成命名變數別名
  activeNodeIds.forEach((nodeId) => {
    const varName = context.symbolTable.getVarName(nodeId);
    writer.writeLine(`const ${varName} = flowState['${nodeId}'];`);
  });

  writer.blankLine();
}

// ============================================================
// 單節點代碼生成器
// ============================================================

function generateSingleNode(
  writer: CodeBlockWriter,
  node: FlowNode,
  context: CompilerContext
): void {
  writer.writeLine(`// --- ${node.label} (${node.nodeType}) ---`);
  generateNodeBody(writer, node, context);

  // 為非輸出節點生成命名變數別名（Output 節點通常是 return，不需要別名）
  if (node.category !== NodeCategory.OUTPUT) {
    const varName = context.symbolTable.getVarName(node.id);
    writer.writeLine(`const ${varName} = flowState['${node.id}'];`);
  }
}

function generateNodeBody(
  writer: CodeBlockWriter,
  node: FlowNode,
  context: CompilerContext
): void {
  const plugin = getPlugin(node.nodeType);

  if (plugin) {
    const pluginCtx = createPluginContext(context);
    plugin.generate(node, writer, pluginCtx);
  } else {
    writer.writeLine(`// TODO: 尚未實作節點類型 "${node.nodeType}"`);
    writer.writeLine(`flowState['${node.id}'] = undefined;`);
  }
}

// ============================================================
// Plugin Context 工廠
// ============================================================

function createPluginContext(
  context: CompilerContext
): PluginContext & { __platformResponse?: PlatformAdapter["generateResponse"] } {
  return {
    ir: context.ir,
    nodeMap: context.nodeMap,
    envVars: context.envVars,
    imports: context.imports,
    requiredPackages: context.requiredPackages,

    getVarName(nodeId: NodeId): string {
      return context.symbolTable.getVarName(nodeId);
    },

    resolveExpression(expr: string, currentNodeId?: NodeId): string {
      const exprContext: ExpressionContext = {
        ir: context.ir,
        nodeMap: context.nodeMap,
        symbolTable: context.symbolTable,
        scopeStack: context.scopeStack.length > 0
          ? [...context.scopeStack]
          : undefined,
        // 合併子區塊 + DAG 排除清單
        blockScopedNodeIds: context.symbolTableExclusions.size > 0
          ? context.symbolTableExclusions
          : undefined,
        currentNodeId,
      };
      return parseExpression(expr, exprContext);
    },

    resolveEnvVars(url: string): string {
      return resolveEnvVars(url, context);
    },

    generateChildNode(writer: CodeBlockWriter, node: FlowNode): void {
      // 標記此節點為「子區塊生成」，避免在頂層重複生成 + 避免 Symbol Table 別名洩漏
      context.childBlockNodeIds.add(node.id);
      context.symbolTableExclusions.add(node.id);
      generateNodeBody(writer, node, context);
    },

    pushScope(nodeId: NodeId, scopeVar: string): void {
      context.scopeStack.push({ nodeId, scopeVar });
    },

    popScope(): void {
      context.scopeStack.pop();
    },

    __platformResponse: context.platform.generateResponse.bind(context.platform),
  };
}

// ============================================================
// 輔助函式
// ============================================================

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

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

function collectRequiredPackages(ir: FlowIR, context: CompilerContext): void {
  for (const node of ir.nodes) {
    // 從 Plugin 取得依賴
    const plugin = getPlugin(node.nodeType);
    if (plugin?.getRequiredPackages) {
      const packages = plugin.getRequiredPackages(node);
      packages.forEach((pkg: string) => context.requiredPackages.add(pkg));
    } else {
      // Fallback: 靜態映射
      const packages = NODE_PACKAGE_MAP[node.nodeType];
      if (packages) {
        packages.forEach((pkg) => context.requiredPackages.add(pkg));
      }
    }

    // 特殊處理 SQL ORM（Plugin 已處理，此為雙重保險）
    if (node.nodeType === ActionType.SQL_QUERY) {
      const params = node.params as import("../ir/types").SqlQueryParams;
      const ormPackages = ORM_PACKAGE_MAP[params.orm] ?? [];
      ormPackages.forEach((pkg) => context.requiredPackages.add(pkg));
    }
  }

  // 平台隱含依賴
  const platformDeps = context.platform.getImplicitDependencies();
  platformDeps.forEach((pkg) => context.requiredPackages.add(pkg));
}

// ============================================================
// Source Map
// ============================================================

function buildSourceMap(
  code: string,
  ir: FlowIR,
  filePath: string
): SourceMap {
  const lines = code.split("\n");
  const mappings: Record<string, { startLine: number; endLine: number }> = {};

  const nodeMarkerRegex = /^[\s]*\/\/ --- (.+?) \((.+?)\) ---$/;

  let currentNodeId: string | null = null;
  let currentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const match = lines[i].match(nodeMarkerRegex);

    if (match) {
      if (currentNodeId) {
        mappings[currentNodeId] = {
          startLine: currentStartLine,
          endLine: lineNum - 1,
        };
      }

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

  if (currentNodeId) {
    mappings[currentNodeId] = {
      startLine: currentStartLine,
      endLine: lines.length,
    };
  }

  const trigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER);
  if (trigger && !mappings[trigger.id]) {
    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].includes("export async function") ||
        lines[i].includes("@schedule")
      ) {
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
