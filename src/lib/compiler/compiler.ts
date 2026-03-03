/**
 * Flow2Code AST Compiler Core (v2)
 *
 * Architecture:
 *   1. Platform Adapter — Decoupled from Next.js, supports Express / Cloudflare Workers
 *   2. Plugin System — Node generation logic is externally registerable
 *   3. Expression Parser — Recursive Descent Parser replaces regex
 *   4. Type Inference — Generates typed FlowState interface instead of Record<string, any>
 *   5. Scoped State — Loops/try-catch use local scope to prevent variable shadowing
 *
 * Public API (backward-compatible):
 *   - compile(ir)                → CompileResult (default: nextjs platform)
 *   - compile(ir, { platform })  → CompileResult (specified platform)
 *   - traceLineToNode(sourceMap, line) → Reverse lookup node from line number
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

// ── Internal Modules ──
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
// Compile Result
// ============================================================

export interface CompileResult {
  success: boolean;
  code?: string;
  errors?: string[];
  /** Generated file path (relative) */
  filePath?: string;
  /** Dependency report */
  dependencies?: DependencyReport;
  /** Source Map (nodeId ↔ line number mapping) */
  sourceMap?: SourceMap;
}

/** Dependency report */
export interface DependencyReport {
  /** All required packages */
  all: string[];
  /** Missing packages (compared with package.json) */
  missing: string[];
  /** Suggested install command */
  installCommand?: string;
}

/** Source Map: line number ↔ node ID mapping */
export interface SourceMap {
  version: 1;
  generatedFile: string;
  /** nodeId → { startLine, endLine } */
  mappings: Record<string, { startLine: number; endLine: number }>;
}

// ============================================================
// Compile Options
// ============================================================

export interface CompileOptions {
  /** Target platform (default: "nextjs") */
  platform?: PlatformName;
  /** Additional Node Plugins */
  plugins?: NodePlugin[];
}

// ============================================================
// Internal Compiler Context
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
  /** Scope Stack: tracks current local scope (for-loop / try-catch etc.) */
  scopeStack: ScopeEntry[];
  /** Node IDs generated within child blocks (if/else, for-loop body, try/catch) */
  childBlockNodeIds: Set<NodeId>;
  /** Whether DAG concurrent scheduling is enabled (replaces hierarchical Promise.all) */
  dagMode: boolean;
  /** Node IDs that should NOT use Symbol Table aliases (child block + DAG promise nodes) */
  symbolTableExclusions: Set<NodeId>;
  /** Runtime tracking: node IDs already generated in blocks (prevents duplicate generation) */
  generatedBlockNodeIds: Set<NodeId>;
  /** Plugin Registry for this compile session (per-instance, avoids global pollution) */
  pluginRegistry: PluginRegistry;
}

// ============================================================
// Main Compile Function
// ============================================================

/**
 * Compiles FlowIR into TypeScript source code.
 *
 * Pipeline stages:
 * 1. Validate IR structure
 * 2. Topological sort + concurrency detection
 * 3. Platform adaptation (Next.js / Express / Cloudflare etc.)
 * 4. Plugin-based node code generation
 * 5. IDE-friendly Source Map output
 *
 * @param ir - FlowIR input document
 * @param options - Compile options (platform, plugins, output path etc.)
 * @returns Compile result containing code, filePath, sourceMap, dependencies
 *
 * @example
 * ```ts
 * import { compile } from "flow2code";
 *
 * const result = compile(ir, { platform: "hono" });
 * if (result.success) {
 *   console.log(result.code);
 * }
 * ```
 */
export function compile(ir: FlowIR, options?: CompileOptions): CompileResult {
  // Create per-instance plugin registry (avoids global state pollution)
  const pluginRegistry = createPluginRegistry();
  pluginRegistry.registerAll(builtinPlugins);
  if (options?.plugins) {
    pluginRegistry.registerAll(options.plugins);
  }

  // 1. Validate IR
  const validation = validateFlowIR(ir);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors.map((e) => `[${e.code}] ${e.message}`),
    };
  }

  // 2. Topological sort
  let plan: ExecutionPlan;
  try {
    plan = topologicalSort(ir);
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  // 3. Build context
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

  // Detect concurrency: if execution plan has any concurrent steps, enable DAG scheduling
  const trigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER)!;

  // ── Pre-compute control flow child block nodes (fixes DAG duplicate generation + control flow leaks) ──
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
    // In DAG mode, Symbol Table aliases for all non-trigger nodes are not visible at top level
    for (const node of ir.nodes) {
      if (node.category !== NodeCategory.TRIGGER) {
        context.symbolTableExclusions.add(node.id);
      }
    }
  }

  // 5. Build AST using ts-morph
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("generated.ts", "");

  generateCode(sourceFile, trigger, context);

  // 6. Format and output
  sourceFile.formatText({
    indentSize: 2,
    convertTabsToSpaces: true,
  });

  const code = sourceFile.getFullText();
  const filePath = platform.getOutputFilePath(trigger);

  // Collect dependencies
  collectRequiredPackages(ir, context);

  // Build Source Map
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
// Code Generation Main Logic
// ============================================================

function generateCode(
  sourceFile: SourceFile,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const { platform } = context;

  // Generate imports
  platform.generateImports(sourceFile, trigger, {
    ir: context.ir,
    nodeMap: context.nodeMap,
    envVars: context.envVars,
    imports: context.imports,
  });

  // Generate function (structure determined by platform adapter)
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
 * Generates function body (flowState + trigger init + node chain)
 */
function generateFunctionBody(
  writer: CodeBlockWriter,
  trigger: FlowNode,
  context: CompilerContext
): void {
  const { ir } = context;

  // ── Type-safe flowState declaration ──
  const typeInfo = inferFlowStateTypes(ir, context.pluginRegistry);
  writer.writeLine(typeInfo.interfaceCode);
  writer.writeLine("const flowState: Partial<FlowState> = {};");
  writer.blankLine();

  // ── Trigger initialization (delegated to Platform Adapter) ──
  context.platform.generateTriggerInit(writer, trigger, {
    symbolTable: context.symbolTable,
  });
  writer.blankLine();

  // ── Generate subsequent nodes in topological order ──
  generateNodeChain(writer, trigger.id, context);
}

// generateTriggerInit has been moved to each Platform Adapter implementation

// ============================================================
// ============================================================
// Node Chain Generator (Scheduler)
// ============================================================

// ============================================================
// Control Flow Reachability Analysis
// ============================================================

/**
 * Control flow port mapping: only edges from specific logic node types and specific ports
 * count as control flow edges. Prevents port names like "body" from being
 * misidentified on non-control-flow nodes (e.g., HTTP Trigger).
 */
const CONTROL_FLOW_PORT_MAP: Partial<Record<string, Set<string>>> = {
  [LogicType.IF_ELSE]: new Set(["true", "false"]),
  [LogicType.FOR_LOOP]: new Set(["body"]),
  [LogicType.TRY_CATCH]: new Set(["success", "error"]),
};

/**
 * Determines whether an edge is a control flow edge.
 * Must satisfy: source node is a control flow node AND port is that node's control flow port.
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
 * Pre-computes all "control flow child block nodes".
 *
 * Core algorithm:
 *   1. Build a "stripped graph" by removing control flow edges.
 *   2. BFS from trigger to find all nodes reachable in the stripped graph.
 *   3. Nodes that exist in the original graph but are NOT reachable in the stripped graph
 *      are nodes only reachable via control flow ports — i.e., child block nodes.
 *
 * This ensures:
 *   - If/Else true/false child nodes and all their downstream are marked
 *   - For Loop body child nodes and all their downstream are marked
 *   - Try/Catch success/error child nodes and all their downstream are marked
 *   - Nodes reachable via BOTH control flow AND data flow paths are NOT marked (they belong to top level)
 */
function computeControlFlowDescendants(
  ir: FlowIR,
  triggerId: NodeId
): Set<NodeId> {
  const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));

  // Build adjacency list with control flow edges removed
  const strippedSuccessors = new Map<NodeId, Set<NodeId>>();
  for (const node of ir.nodes) {
    strippedSuccessors.set(node.id, new Set());
  }
  for (const edge of ir.edges) {
    if (isControlFlowEdge(edge, nodeMap)) continue;
    strippedSuccessors.get(edge.sourceNodeId)?.add(edge.targetNodeId);
  }

  // BFS: from trigger, find reachable nodes in the stripped graph
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

  // Unreachable nodes are control flow child block nodes
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
 * Generates subsequent node chains within a block (Block Continuation).
 *
 * After a plugin calls generateChildNode to generate a direct child node,
 * this function continues generating all descendant nodes that belong
 * exclusively to this block, in topological order.
 *
 * Example: If_Else →true→ A → B → C
 * After the plugin generates A, this function continues to generate B and C.
 */
function generateBlockContinuation(
  writer: CodeBlockWriter,
  fromNodeId: NodeId,
  context: CompilerContext
): void {
  // Compute all nodes reachable from fromNodeId (including indirect descendants)
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

  // Generate reachable child block descendant nodes in topological order
  for (const nodeId of context.plan.sortedNodeIds) {
    if (nodeId === fromNodeId) continue;
    if (!reachable.has(nodeId)) continue;
    if (!context.childBlockNodeIds.has(nodeId)) continue;
    if (context.generatedBlockNodeIds.has(nodeId)) continue;

    // Verify all in-block dependencies have been generated
    const deps = context.plan.dependencies.get(nodeId) ?? new Set();
    const allBlockDepsReady = [...deps].every((depId) => {
      // Non-child-block dependencies (top-level nodes) are considered ready
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
// Sequential Mode (used when no concurrency opportunity)
// ============================================================

function generateNodeChainSequential(
  writer: CodeBlockWriter,
  triggerId: NodeId,
  context: CompilerContext
): void {
  const { plan, nodeMap } = context;

  for (const step of plan.steps) {
    // Filter out trigger and nodes already generated in child blocks
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
// DAG Concurrent Mode (per-node promise, only await direct upstream)
// ============================================================

/**
 * Resolves a child block node's dependency to its host DAG node.
 * e.g., if_else → [true: fetch_child], when downstream depends on fetch_child,
 * it should actually await if_else's promise.
 */
function resolveToDAGNodes(
  depId: NodeId,
  triggerId: NodeId,
  context: CompilerContext,
  visited: Set<NodeId> = new Set()
): NodeId[] {
  if (visited.has(depId) || depId === triggerId) return [];
  visited.add(depId);

  // If dep is not a child block node, it IS a DAG node (has its own promise)
  if (!context.childBlockNodeIds.has(depId)) return [depId];

  // Child block node: recurse upstream to find host DAG node
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

  // Collect all non-trigger nodes in topological order
  const allNodeIds = plan.sortedNodeIds.filter((id) => id !== triggerId);

  // Separate output nodes (they contain return, can't be wrapped in promises)
  const outputNodeIds: NodeId[] = [];
  const dagNodeIds: NodeId[] = [];

  for (const id of allNodeIds) {
    // Skip child block nodes (generated internally by parent node's plugin)
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

  // Generate promise IIFE for each worker node
  for (const nodeId of dagNodeIds) {
    const node = nodeMap.get(nodeId)!;

    // Resolve direct upstream dependencies (child block deps mapped to host DAG nodes)
    const rawDeps = [...(plan.dependencies.get(nodeId) ?? [])];
    const resolvedDeps = new Set<NodeId>();
    for (const depId of rawDeps) {
      for (const dagDep of resolveToDAGNodes(depId, triggerId, context)) {
        resolvedDeps.add(dagDep);
      }
    }
    // Exclude self (prevent self-loop)
    resolvedDeps.delete(nodeId);

    const promiseVar = `p_${sanitizeId(nodeId)}`;
    writer.write(`const ${promiseVar} = (async () => `).block(() => {
      // Await all direct upstream promises
      for (const depId of resolvedDeps) {
        writer.writeLine(`await p_${sanitizeId(depId)};`);
      }
      writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
      generateNodeBody(writer, node, context);
    });
    writer.writeLine(`)();`);
    // Prevent Unhandled Promise Rejection (errors still propagate via downstream await)
    writer.writeLine(`${promiseVar}.catch(() => {});`);
    writer.blankLine();
  }

  // ── Sync Barrier: ensure all DAG promises complete, prevent early termination in serverless environments ──
  if (dagNodeIds.length > 0) {
    writer.writeLine("// --- Sync Barrier: await all DAG promises before output ---");
    const allPromiseVars = dagNodeIds.map((id) => `p_${sanitizeId(id)}`);
    writer.writeLine(`await Promise.allSettled([${allPromiseVars.join(", ")}]);`);
    writer.blankLine();
  }

  // Output nodes: sequentially await upstream promises, then execute (contains return)
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
// Concurrent Node Generator (Promise.all)
// ============================================================

function generateConcurrentNodes(
  writer: CodeBlockWriter,
  nodeIds: NodeId[],
  context: CompilerContext
): void {
  const { nodeMap } = context;
  // Filter nodes already generated in child blocks
  const activeNodeIds = nodeIds.filter((id) => !context.childBlockNodeIds.has(id));
  if (activeNodeIds.length === 0) return;

  // No need for Promise.all when only one node remains
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

  // Generate named variable aliases
  activeNodeIds.forEach((nodeId) => {
    const varName = context.symbolTable.getVarName(nodeId);
    writer.writeLine(`const ${varName} = flowState['${nodeId}'];`);
  });

  writer.blankLine();
}

// ============================================================
// Single Node Code Generator
// ============================================================

function generateSingleNode(
  writer: CodeBlockWriter,
  node: FlowNode,
  context: CompilerContext
): void {
  writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
  generateNodeBody(writer, node, context);

  // Generate named variable alias for non-output nodes (output nodes are usually return, no alias needed)
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
    throw new Error(
      `[flow2code] Unsupported node type: "${node.nodeType}". ` +
      `Register a plugin via pluginRegistry.register() or use a built-in node type.`
    );
  }
}

// ============================================================
// Plugin Context Factory
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
        // Merge child block + DAG exclusion list
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
      // Mark this node as "child block generated" to prevent top-level duplicate + Symbol Table alias leak
      context.childBlockNodeIds.add(node.id);
      context.symbolTableExclusions.add(node.id);
      context.generatedBlockNodeIds.add(node.id);
      writer.writeLine(`// --- ${node.label} (${node.nodeType}) [${node.id}] ---`);
      generateNodeBody(writer, node, context);

      // Generate all descendant continuation chains for this child node (fixes control flow leak)
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
// Helper Functions
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
  // If URL contains any ${...} expressions (e.g. flowState refs), use backticks for interpolation
  if (url.includes("${")) {
    return "`" + url + "`";
  }
  return `"${url}"`;
}

function collectRequiredPackages(ir: FlowIR, context: CompilerContext): void {
  for (const node of ir.nodes) {
    // Get dependencies from Plugin (Plugin contains all node package info)
    const plugin = context.pluginRegistry.get(node.nodeType);
    if (plugin?.getRequiredPackages) {
      const packages = plugin.getRequiredPackages(node);
      packages.forEach((pkg: string) => context.requiredPackages.add(pkg));
    }
  }

  // Platform implicit dependencies
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
 * Given a line number, reverse-lookup the corresponding nodeId.
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
