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
  FlowEdge,
  NodeId,
  HttpWebhookParams,
  CronJobParams,
  ManualTriggerParams,
} from "../ir/types";
import {
  TriggerType,
  LogicType,
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
  type PluginRegistry,
  createPluginRegistry,
} from "./plugins/index";
import { builtinPlugins } from "./plugins/builtin";
import { inferFlowStateTypes } from "./type-inference";
import { buildSymbolTable, type SymbolTable } from "./symbol-table";

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
  /** 執行時追蹤：已在區塊內生成的節點 ID（防止重複生成） */
  generatedBlockNodeIds: Set<NodeId>;
  /** 此次編譯使用的 Plugin Registry（per-instance，避免全域汙染） */
  pluginRegistry: PluginRegistry;
}

// ============================================================
// 主編譯函式
// ============================================================

export function compile(ir: FlowIR, options?: CompileOptions): CompileResult {
  // 建立 per-instance plugin registry（避免全域狀態汙染）
  const pluginRegistry = createPluginRegistry();
  pluginRegistry.registerAll(builtinPlugins);
  if (options?.plugins) {
    pluginRegistry.registerAll(options.plugins);
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
    generatedBlockNodeIds: new Set(),
    pluginRegistry,
  };

  // 偵測並發機會：若執行計畫有任何並發步驟，啟用 DAG 排程
  const trigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER)!;

  // ── 預先計算控制流子區塊節點（修復 DAG 重複生成 + Control Flow 外洩）──
  const preComputedBlockNodes = computeControlFlowDescendants(ir, trigger.id);
  for (const nodeId of preComputedBlockNodes) {
    context.childBlockNodeIds.add(nodeId);
    context.symbolTableExclusions.add(nodeId);
  }

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

  // ── 觸發器初始化（委託給 Platform Adapter） ──
  context.platform.generateTriggerInit(writer, trigger, {
    symbolTable: context.symbolTable,
  });
  writer.blankLine();

  // ── 按拓撲排序生成後續節點 ──
  generateNodeChain(writer, trigger.id, context);
}

// generateTriggerInit 已移至各 Platform Adapter 實作

// ============================================================
// ============================================================
// 節點鏈生成器（調度器）
// ============================================================

// ============================================================
// 控制流可達性分析（Reachability Analysis）
// ============================================================

/**
 * 控制流端口映射：只有來自特定邏輯節點類型的特定端口才算控制流邊。
 * 避免 "body" 等端口名稱在非控制流節點（如 HTTP Trigger）上被誤判。
 */
const CONTROL_FLOW_PORT_MAP: Partial<Record<string, Set<string>>> = {
  [LogicType.IF_ELSE]: new Set(["true", "false"]),
  [LogicType.FOR_LOOP]: new Set(["body"]),
  [LogicType.TRY_CATCH]: new Set(["success", "error"]),
};

/**
 * 判斷一條邊是否為控制流邊。
 * 必須同時滿足：來源節點是控制流節點 AND 端口是該節點的控制流端口。
 */
function isControlFlowEdge(
  edge: FlowEdge,
  nodeMap: Map<NodeId, FlowNode>
): boolean {
  const sourceNode = nodeMap.get(edge.sourceNodeId);
  if (!sourceNode) return false;
  const controlPorts = CONTROL_FLOW_PORT_MAP[sourceNode.nodeType];
  return controlPorts !== undefined && controlPorts.has(edge.sourcePortId);
}

/**
 * 預先計算所有「控制流子區塊節點」。
 *
 * 核心演算法：
 *   1. 建立一個「去除控制流邊」的簡化圖（stripped graph）。
 *   2. 從 trigger 出發做 BFS，找出在簡化圖中可達的節點。
 *   3. 原始圖中存在、但在簡化圖中不可達的節點，
 *      就是「只能透過控制流端口到達的節點」——即子區塊節點。
 *
 * 這確保了：
 *   - If/Else 的 true/false 子節點及其下游全部被標記
 *   - For Loop 的 body 子節點及其下游全部被標記
 *   - Try/Catch 的 success/error 子節點及其下游全部被標記
 *   - 若某節點同時有「控制流路徑」與「資料流路徑」可達，則不標記（它屬於頂層）
 */
function computeControlFlowDescendants(
  ir: FlowIR,
  triggerId: NodeId
): Set<NodeId> {
  const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));

  // 建立去除控制流邊的鄰接表
  const strippedSuccessors = new Map<NodeId, Set<NodeId>>();
  for (const node of ir.nodes) {
    strippedSuccessors.set(node.id, new Set());
  }
  for (const edge of ir.edges) {
    if (isControlFlowEdge(edge, nodeMap)) continue;
    strippedSuccessors.get(edge.sourceNodeId)?.add(edge.targetNodeId);
  }

  // BFS：從 trigger 出發，在簡化圖中找可達節點
  const reachableWithoutControlFlow = new Set<NodeId>();
  const queue: NodeId[] = [triggerId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachableWithoutControlFlow.has(id)) continue;
    reachableWithoutControlFlow.add(id);
    for (const succ of strippedSuccessors.get(id) ?? []) {
      if (!reachableWithoutControlFlow.has(succ)) {
        queue.push(succ);
      }
    }
  }

  // 不可達的就是控制流子區塊節點
  const childBlockNodeIds = new Set<NodeId>();
  for (const node of ir.nodes) {
    if (node.id === triggerId) continue;
    if (!reachableWithoutControlFlow.has(node.id)) {
      childBlockNodeIds.add(node.id);
    }
  }

  return childBlockNodeIds;
}

/**
 * 生成區塊內的後續節點鏈（Block Continuation）。
 *
 * 當 plugin 呼叫 generateChildNode 生成直接子節點後，
 * 此函式會在同一個區塊內，按拓撲順序繼續生成所有
 * 「專屬於此區塊的後代節點」。
 *
 * 例如：If_Else →true→ A → B → C
 * Plugin 生成 A 後，此函式會接著生成 B 和 C。
 */
function generateBlockContinuation(
  writer: CodeBlockWriter,
  fromNodeId: NodeId,
  context: CompilerContext
): void {
  // 計算從 fromNodeId 可達的所有節點（含間接後代）
  const reachable = new Set<NodeId>();
  const bfsQueue: NodeId[] = [fromNodeId];
  const edgeSuccessors = new Map<NodeId, NodeId[]>();

  for (const edge of context.ir.edges) {
    if (!edgeSuccessors.has(edge.sourceNodeId)) {
      edgeSuccessors.set(edge.sourceNodeId, []);
    }
    edgeSuccessors.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }

  while (bfsQueue.length > 0) {
    const id = bfsQueue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const succ of edgeSuccessors.get(id) ?? []) {
      if (!reachable.has(succ)) {
        bfsQueue.push(succ);
      }
    }
  }

  // 按拓撲序生成可達且屬於子區塊的後代節點
  for (const nodeId of context.plan.sortedNodeIds) {
    if (nodeId === fromNodeId) continue;
    if (!reachable.has(nodeId)) continue;
    if (!context.childBlockNodeIds.has(nodeId)) continue;
    if (context.generatedBlockNodeIds.has(nodeId)) continue;

    // 確認所有區塊內的依賴都已生成
    const deps = context.plan.dependencies.get(nodeId) ?? new Set();
    const allBlockDepsReady = [...deps].every((depId) => {
      // 非子區塊依賴（頂層節點）視為已就緒
      if (!context.childBlockNodeIds.has(depId)) return true;
      return context.generatedBlockNodeIds.has(depId);
    });

    if (!allBlockDepsReady) continue;

    const node = context.nodeMap.get(nodeId);
    if (!node) continue;

    context.generatedBlockNodeIds.add(nodeId);
    context.symbolTableExclusions.add(nodeId);
    writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
    generateNodeBody(writer, node, context);
  }
}

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
      writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
      generateNodeBody(writer, node, context);
    });
    writer.writeLine(`)();`);
    // 防止 Unhandled Promise Rejection（錯誤仍會透過下游 await 傳播）
    writer.writeLine(`${promiseVar}.catch(() => {});`);
    writer.blankLine();
  }

  // ── Sync Barrier：確保所有 DAG Promise 完成，防止 Serverless 環境提早終止 ──
  if (dagNodeIds.length > 0) {
    writer.writeLine("// --- Sync Barrier: await all DAG promises before output ---");
    const allPromiseVars = dagNodeIds.map((id) => `p_${sanitizeId(id)}`);
    writer.writeLine(`await Promise.allSettled([${allPromiseVars.join(", ")}]);`);
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
    writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
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
  writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
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
  const plugin = context.pluginRegistry.get(node.nodeType);

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
      context.generatedBlockNodeIds.add(node.id);
      writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
      generateNodeBody(writer, node, context);

      // 生成此子節點的所有後代延續鏈（修復 Control Flow 外洩問題）
      generateBlockContinuation(writer, node.id, context);
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
    // 從 Plugin 取得依賴（Plugin 已包含所有節點的套件資訊）
    const plugin = context.pluginRegistry.get(node.nodeType);
    if (plugin?.getRequiredPackages) {
      const packages = plugin.getRequiredPackages(node);
      packages.forEach((pkg: string) => context.requiredPackages.add(pkg));
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

  // Match: // --- Label (nodeType) [nodeId] ---
  const nodeMarkerRegex = /^[\s]*\/\/ --- .+? \(.+?\) \[(.+?)\] ---$/;

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

      const [, nodeId] = match;
      if (ir.nodes.some((n) => n.id === nodeId)) {
        currentNodeId = nodeId;
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
