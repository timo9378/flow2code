/**
 * Flow2Code Universal Decompiler — TypeScript → FlowIR
 *
 * Reverse-parses **any** TypeScript source code into FlowIR intermediate representation.
 * Designed for AI Code Audit: accepts AI-generated TypeScript and visualizes its logic flow.
 *
 * Strategy:
 *   1. AST Analysis (primary): ts-morph parses TS AST, pattern-matches known constructs
 *   2. Data Flow Tracking: variable def-use chains build real edges (not linear chaining)
 *   3. Source Map Hints (optional): if `// --- label [nodeType] [nodeId] ---` markers exist,
 *      they enhance node labeling but are NOT required
 *
 * Supported patterns:
 *   - Export functions / arrow functions / class methods → Triggers
 *   - `await fetch(...)` → Fetch API nodes
 *   - `if/else` → If/Else logic nodes
 *   - `for...of` / `for...in` / `for` → Loop nodes
 *   - `try/catch` → TryCatch nodes
 *   - Variable declarations → Variable nodes
 *   - Generic `await expr` → Custom code action nodes
 *   - Return / Response statements → Output nodes
 *
 * Edge building:
 *   - Data flow edges: tracks which variables are produced and consumed by each node
 *   - Control flow edges: if/else branches, loop bodies, try/catch blocks
 *   - Sequential edges: statements in the same scope with no explicit data dependency
 */

import {
  Project,
  SyntaxKind,
  type SourceFile,
  type Node as TSNode,
  type FunctionDeclaration,
  type ArrowFunction,
  type MethodDeclaration,
  type Block,
  type Statement,
  type VariableStatement,
  type VariableDeclaration,
  type IfStatement,
  type ForOfStatement,
  type ForInStatement,
  type ForStatement,
  type TryStatement,
  type ReturnStatement,
  type ExpressionStatement,
  type AwaitExpression,
  type CallExpression,
} from "ts-morph";
import type {
  FlowIR,
  FlowNode,
  FlowEdge,
  NodeType,
  InputPort,
  OutputPort,
  HttpWebhookParams,
  FetchApiParams,
  ReturnResponseParams,
  IfElseParams,
  ForLoopParams,
  TryCatchParams,
  CustomCodeParams,
  DeclareVariableParams,
  TransformParams,
  ManualTriggerParams,
} from "../ir/types";
import {
  CURRENT_IR_VERSION,
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
} from "../ir/types";

// ============================================================
// Public API
// ============================================================

export interface DecompileResult {
  success: boolean;
  ir?: FlowIR;
  errors?: string[];
  /** Confidence score 0-1 indicating decompilation accuracy */
  confidence: number;
  /** Audit hints: detected issues or notable patterns */
  audit?: AuditHint[];
}

/** Audit hint: a detected issue or notable pattern in the code */
export interface AuditHint {
  nodeId: string;
  severity: "info" | "warning" | "error";
  message: string;
  /** Source line number (1-indexed) */
  line?: number;
}

export interface DecompileOptions {
  /** File name or full file path (used for route inference) */
  fileName?: string;
  /** Target function name to decompile (omit to auto-detect) */
  functionName?: string;
  /** Enable audit hints (default: true) */
  audit?: boolean;
}

/**
 * Decompiles any TypeScript source code into FlowIR.
 *
 * @param code - TypeScript source code (arbitrary, not limited to flow2code output)
 * @param options - Optional settings
 * @returns DecompileResult with IR, confidence, and optional audit hints
 */
export function decompile(
  code: string,
  options: DecompileOptions = {}
): DecompileResult {
  const errors: string[] = [];
  const { fileName = "input.ts", audit: enableAudit = true } = options;

  try {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(fileName, code);

    // Step 1: Find the target function to decompile
    const targetFn = findTargetFunction(sourceFile, options.functionName);
    if (!targetFn) {
      errors.push("No exported function found to decompile");
      return { success: false, errors, confidence: 0 };
    }

    // Step 2: Create decompile context
    const ctx = createDecompileContext();

    // Step 3: Create trigger node from the function signature
    const trigger = createTriggerFromFunction(targetFn, sourceFile, ctx);
    ctx.addNode(trigger);

    // Step 4: Walk the function body and extract nodes
    const body = targetFn.fn.getBody();
    if (body && body.getKind() === SyntaxKind.Block) {
      walkBlock(body as Block, trigger.id, ctx);
    }

    // Step 5: Build edges from data flow tracking
    buildEdges(ctx);

    // Step 6: Compute audit hints
    const auditHints = enableAudit ? computeAuditHints(ctx) : [];

    // Step 7: Assemble IR
    const now = new Date().toISOString();
    const ir: FlowIR = {
      version: CURRENT_IR_VERSION,
      meta: {
        name: targetFn.name ?? fileName.replace(/\.(ts|tsx|js|jsx)$/, ""),
        description: `Decompiled from ${fileName}`,
        createdAt: now,
        updatedAt: now,
      },
      nodes: ctx.getNodes(),
      edges: ctx.getEdges(),
    };

    // Confidence based on how many nodes we extracted
    const nodeCount = ir.nodes.length;
    const hasControlFlow = ir.nodes.some(n => n.category === NodeCategory.LOGIC);
    const confidence = Math.min(
      0.95,
      0.3 + nodeCount * 0.08 + (hasControlFlow ? 0.15 : 0)
    );

    return {
      success: true,
      ir,
      errors: errors.length > 0 ? errors : undefined,
      confidence,
      audit: auditHints.length > 0 ? auditHints : undefined,
    };
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)],
      confidence: 0,
    };
  }
}

// ============================================================
// Decompile Context (tracks nodes, edges, data flow)
// ============================================================

interface VariableDef {
  nodeId: string;
  portId: string;
  varName: string;
}

interface VariableUse {
  nodeId: string;
  portId: string;
  varName: string;
}

interface DecompileContext {
  nodes: Map<string, FlowNode>;
  edgeList: FlowEdge[];
  /** Variable definitions: var name → producing node */
  varDefs: Map<string, VariableDef>;
  /** Variable uses: consuming node → used variables */
  varUses: Map<string, VariableUse[]>;
  /** Sequential predecessors: nodeId → previous nodeId in same scope */
  seqPredecessors: Map<string, string>;
  /** Control flow edges: parent logic node → child nodes by port */
  controlFlowChildren: Map<string, { portId: string; nodeId: string }[]>;
  /** Audit data: nodes with potential issues */
  auditData: AuditHint[];
  /** Counters for unique IDs */
  counters: Record<string, number>;
  /** Source line tracking */
  nodeLines: Map<string, number>;

  addNode(node: FlowNode, line?: number): void;
  getNodes(): FlowNode[];
  getEdges(): FlowEdge[];
  nextId(prefix: string): string;
}

function createDecompileContext(): DecompileContext {
  const ctx: DecompileContext = {
    nodes: new Map(),
    edgeList: [],
    varDefs: new Map(),
    varUses: new Map(),
    seqPredecessors: new Map(),
    controlFlowChildren: new Map(),
    auditData: [],
    counters: {},
    nodeLines: new Map(),

    addNode(node: FlowNode, line?: number) {
      ctx.nodes.set(node.id, node);
      if (line !== undefined) ctx.nodeLines.set(node.id, line);
    },

    getNodes(): FlowNode[] {
      return Array.from(ctx.nodes.values());
    },

    getEdges(): FlowEdge[] {
      return ctx.edgeList;
    },

    nextId(prefix: string): string {
      ctx.counters[prefix] = (ctx.counters[prefix] ?? 0) + 1;
      return `${prefix}_${ctx.counters[prefix]}`;
    },
  };
  return ctx;
}

// ============================================================
// Function Discovery
// ============================================================

interface TargetFunction {
  name: string | undefined;
  fn: FunctionDeclaration | ArrowFunction | MethodDeclaration;
  httpMethod?: string;
  isExported: boolean;
}

function findTargetFunction(
  sourceFile: SourceFile,
  targetName?: string
): TargetFunction | null {
  const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  // Priority 1: Explicit target function name (user override via --function flag)
  if (targetName) {
    const fn = sourceFile.getFunction(targetName);
    if (fn) {
      const name = fn.getName();
      const httpMethod = name && httpMethods.includes(name.toUpperCase()) ? name.toUpperCase() : undefined;
      return { name: targetName, fn, httpMethod, isExported: fn.isExported() };
    }
  }

  // Priority 2: Named export matching HTTP method (Next.js App Router style)
  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName();
    if (name && httpMethods.includes(name.toUpperCase())) {
      return { name, fn, httpMethod: name.toUpperCase(), isExported: true };
    }
  }

  // Priority 3: Any exported function
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported()) {
      return { name: fn.getName(), fn, isExported: true };
    }
  }

  // Priority 4: Any function at all
  const allFns = sourceFile.getFunctions();
  if (allFns.length > 0) {
    const fn = allFns[0];
    return { name: fn.getName(), fn, isExported: fn.isExported() };
  }

  // Priority 5: Exported arrow function (const handler = async () => {...})
  for (const stmt of sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && init.getKind() === SyntaxKind.ArrowFunction) {
        return {
          name: decl.getName(),
          fn: init as ArrowFunction,
          isExported: true,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Trigger Creation
// ============================================================

function createTriggerFromFunction(
  target: TargetFunction,
  sourceFile: SourceFile,
  ctx: DecompileContext
): FlowNode {
  const id = ctx.nextId("trigger");

  if (target.httpMethod) {
    const routePath = inferRoutePath(sourceFile);
    const method = target.httpMethod as HttpWebhookParams["method"];
    const parseBody = method !== "GET";

    return {
      id,
      nodeType: TriggerType.HTTP_WEBHOOK,
      category: NodeCategory.TRIGGER,
      label: `${method} ${routePath}`,
      params: { method, routePath, parseBody } as HttpWebhookParams,
      inputs: [],
      outputs: [
        { id: "request", label: "Request", dataType: "object" },
        { id: "body", label: "Body", dataType: "object" },
        { id: "query", label: "Query", dataType: "object" },
      ],
    };
  }

  // Non-HTTP: manual trigger
  return {
    id,
    nodeType: TriggerType.MANUAL,
    category: NodeCategory.TRIGGER,
    label: target.name ?? "Entry Point",
    params: {
      functionName: target.name ?? "handler",
      args: target.fn.getParameters?.()
        ? target.fn.getParameters().map((p) => ({
          name: p.getName(),
          type: inferDataType(p.getType().getText()),
        }))
        : [],
    } as ManualTriggerParams,
    inputs: [],
    outputs: [{ id: "output", label: "Output", dataType: "any" }],
  };
}

// ============================================================
// Block Walker (core recursive AST traversal)
// ============================================================

function walkBlock(
  block: Block,
  parentNodeId: string,
  ctx: DecompileContext,
  controlFlowPort?: string
): void {
  const statements = block.getStatements();
  let lastNodeId = parentNodeId;

  for (const stmt of statements) {
    const nodeId = processStatement(stmt, lastNodeId, ctx);
    if (nodeId) {
      // Register sequential connection
      if (lastNodeId !== parentNodeId || !controlFlowPort) {
        ctx.seqPredecessors.set(nodeId, lastNodeId);
      }
      // Register control flow connection
      if (lastNodeId === parentNodeId && controlFlowPort) {
        if (!ctx.controlFlowChildren.has(parentNodeId)) {
          ctx.controlFlowChildren.set(parentNodeId, []);
        }
        ctx.controlFlowChildren.get(parentNodeId)!.push({
          portId: controlFlowPort,
          nodeId,
        });
      }
      lastNodeId = nodeId;
    }
  }
}

function processStatement(
  stmt: Statement,
  prevNodeId: string,
  ctx: DecompileContext
): string | null {
  const kind = stmt.getKind();
  const line = stmt.getStartLineNumber();

  switch (kind) {
    case SyntaxKind.VariableStatement:
      return processVariableStatement(stmt as VariableStatement, prevNodeId, ctx, line);

    case SyntaxKind.IfStatement:
      return processIfStatement(stmt as IfStatement, prevNodeId, ctx, line);

    case SyntaxKind.ForOfStatement:
      return processForOfStatement(stmt as ForOfStatement, prevNodeId, ctx, line);

    case SyntaxKind.ForInStatement:
      return processForInStatement(stmt as ForInStatement, prevNodeId, ctx, line);

    case SyntaxKind.ForStatement:
      return processForStatement(stmt as ForStatement, prevNodeId, ctx, line);

    case SyntaxKind.TryStatement:
      return processTryStatement(stmt as TryStatement, prevNodeId, ctx, line);

    case SyntaxKind.ReturnStatement:
      return processReturnStatement(stmt as ReturnStatement, prevNodeId, ctx, line);

    case SyntaxKind.ExpressionStatement:
      return processExpressionStatement(stmt as ExpressionStatement, prevNodeId, ctx, line);

    default:
      return null;
  }
}

// ============================================================
// Statement Processors
// ============================================================

function processVariableStatement(
  stmt: VariableStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string | null {
  const declarations = stmt.getDeclarations();
  if (declarations.length === 0) return null;

  // Process the first declaration (most common case)
  const decl = declarations[0];
  return processVariableDeclaration(decl, ctx, line);
}

function processVariableDeclaration(
  decl: VariableDeclaration,
  ctx: DecompileContext,
  line: number
): string | null {
  const varName = decl.getName();
  const init = decl.getInitializer();
  if (!init) return null;

  const initText = init.getText();

  // Pattern: await fetch(...) → Fetch API node
  if (isFetchCall(init)) {
    const nodeId = ctx.nextId("fetch");
    const node = parseFetchNode(nodeId, initText, varName);
    ctx.addNode(node, line);
    ctx.varDefs.set(varName, { nodeId, portId: "data", varName });
    return nodeId;
  }

  // Pattern: await someAsyncCall(...) → Custom Code node
  if (hasAwaitExpression(init)) {
    const nodeId = ctx.nextId("async_op");
    const awaitedCode = extractAwaitedExpression(init);
    ctx.addNode({
      id: nodeId,
      nodeType: ActionType.CUSTOM_CODE,
      category: NodeCategory.ACTION,
      label: inferLabel(awaitedCode, varName),
      params: { code: awaitedCode, returnVariable: varName } as CustomCodeParams,
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    }, line);
    ctx.varDefs.set(varName, { nodeId, portId: "result", varName });
    trackVariableUses(nodeId, initText, ctx);
    return nodeId;
  }

  // Pattern: const x = expression → Variable Declare or Transform
  if (isSimpleDeclaration(init)) {
    const nodeId = ctx.nextId("var");
    const dataType = inferDataType(decl.getType().getText());
    const isConst = decl.getVariableStatement()?.getDeclarationKind()?.toString() === "const";
    ctx.addNode({
      id: nodeId,
      nodeType: VariableType.DECLARE,
      category: NodeCategory.VARIABLE,
      label: varName,
      params: {
        name: varName,
        dataType,
        initialValue: initText,
        isConst: isConst ?? true,
      } as DeclareVariableParams,
      inputs: [],
      outputs: [{ id: "value", label: "Value", dataType }],
    }, line);
    ctx.varDefs.set(varName, { nodeId, portId: "value", varName });
    trackVariableUses(nodeId, initText, ctx);
    return nodeId;
  }

  // Pattern: const x = someTransformation → Transform node
  const nodeId = ctx.nextId("transform");
  ctx.addNode({
    id: nodeId,
    nodeType: VariableType.TRANSFORM,
    category: NodeCategory.VARIABLE,
    label: varName,
    params: { expression: initText } as TransformParams,
    inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
    outputs: [{ id: "output", label: "Output", dataType: "any" }],
  }, line);
  ctx.varDefs.set(varName, { nodeId, portId: "output", varName });
  trackVariableUses(nodeId, initText, ctx);
  return nodeId;
}

function processIfStatement(
  stmt: IfStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string {
  const nodeId = ctx.nextId("if");
  const condition = stmt.getExpression().getText();

  ctx.addNode({
    id: nodeId,
    nodeType: LogicType.IF_ELSE,
    category: NodeCategory.LOGIC,
    label: `if (${truncate(condition, 40)})`,
    params: { condition } as IfElseParams,
    inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
    outputs: [
      { id: "true", label: "True", dataType: "any" },
      { id: "false", label: "False", dataType: "any" },
    ],
  }, line);

  trackVariableUses(nodeId, condition, ctx);

  // Walk true branch
  const thenBlock = stmt.getThenStatement();
  if (thenBlock.getKind() === SyntaxKind.Block) {
    walkBlock(thenBlock as Block, nodeId, ctx, "true");
  }

  // Walk false/else branch
  const elseStmt = stmt.getElseStatement();
  if (elseStmt) {
    if (elseStmt.getKind() === SyntaxKind.Block) {
      walkBlock(elseStmt as Block, nodeId, ctx, "false");
    } else if (elseStmt.getKind() === SyntaxKind.IfStatement) {
      // else if → nested if
      const nestedId = processIfStatement(elseStmt as IfStatement, nodeId, ctx, elseStmt.getStartLineNumber());
      if (!ctx.controlFlowChildren.has(nodeId)) {
        ctx.controlFlowChildren.set(nodeId, []);
      }
      ctx.controlFlowChildren.get(nodeId)!.push({ portId: "false", nodeId: nestedId });
    }
  }

  // Audit: no else branch
  if (!elseStmt) {
    ctx.auditData.push({
      nodeId,
      severity: "info",
      message: "If statement has no else branch — consider handling the negative case",
      line,
    });
  }

  return nodeId;
}

function processForOfStatement(
  stmt: ForOfStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string {
  const nodeId = ctx.nextId("loop");
  const initText = stmt.getInitializer().getText();
  const itemVar = initText.replace(/^(const|let|var)\s+/, "");
  const iterableExpr = stmt.getExpression().getText();

  ctx.addNode({
    id: nodeId,
    nodeType: LogicType.FOR_LOOP,
    category: NodeCategory.LOGIC,
    label: `for (${itemVar} of ${truncate(iterableExpr, 30)})`,
    params: {
      iterableExpression: iterableExpr,
      itemVariable: itemVar,
    } as ForLoopParams,
    inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
    outputs: [
      { id: "item", label: "Item", dataType: "any" },
      { id: "result", label: "Result", dataType: "array" },
    ],
  }, line);

  trackVariableUses(nodeId, iterableExpr, ctx);

  // Walk loop body
  const body = stmt.getStatement();
  if (body.getKind() === SyntaxKind.Block) {
    walkBlock(body as Block, nodeId, ctx, "item");
  }

  return nodeId;
}

function processForInStatement(
  stmt: ForInStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string {
  const nodeId = ctx.nextId("loop");
  const initText = stmt.getInitializer().getText();
  const itemVar = initText.replace(/^(const|let|var)\s+/, "");
  const iterableExpr = stmt.getExpression().getText();

  ctx.addNode({
    id: nodeId,
    nodeType: LogicType.FOR_LOOP,
    category: NodeCategory.LOGIC,
    label: `for (${itemVar} in ${truncate(iterableExpr, 30)})`,
    params: {
      iterableExpression: `Object.keys(${iterableExpr})`,
      itemVariable: itemVar,
    } as ForLoopParams,
    inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
    outputs: [
      { id: "item", label: "Item", dataType: "any" },
      { id: "result", label: "Result", dataType: "array" },
    ],
  }, line);

  trackVariableUses(nodeId, iterableExpr, ctx);

  const body = stmt.getStatement();
  if (body.getKind() === SyntaxKind.Block) {
    walkBlock(body as Block, nodeId, ctx, "item");
  }

  return nodeId;
}

function processForStatement(
  stmt: ForStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string {
  const nodeId = ctx.nextId("loop");
  // Use AST methods to extract for-header components (avoids split on '{' which breaks on object literals)
  const initText = stmt.getInitializer()?.getText() ?? "";
  const condText = stmt.getCondition()?.getText() ?? "";
  const incrText = stmt.getIncrementor()?.getText() ?? "";
  const fullText = `for (${initText}; ${condText}; ${incrText})`;

  ctx.addNode({
    id: nodeId,
    nodeType: LogicType.FOR_LOOP,
    category: NodeCategory.LOGIC,
    label: truncate(fullText, 50),
    params: {
      iterableExpression: fullText,
      itemVariable: "i",
    } as ForLoopParams,
    inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
    outputs: [
      { id: "item", label: "Item", dataType: "any" },
      { id: "result", label: "Result", dataType: "array" },
    ],
  }, line);

  const body = stmt.getStatement();
  if (body.getKind() === SyntaxKind.Block) {
    walkBlock(body as Block, nodeId, ctx, "item");
  }

  return nodeId;
}

function processTryStatement(
  stmt: TryStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string {
  const nodeId = ctx.nextId("trycatch");
  const catchClause = stmt.getCatchClause();
  const errorVar = catchClause?.getVariableDeclaration()?.getName() ?? "error";

  ctx.addNode({
    id: nodeId,
    nodeType: LogicType.TRY_CATCH,
    category: NodeCategory.LOGIC,
    label: "Try / Catch",
    params: { errorVariable: errorVar } as TryCatchParams,
    inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
    outputs: [
      { id: "success", label: "Success", dataType: "any" },
      { id: "error", label: "Error", dataType: "object" },
    ],
  }, line);

  // Walk try block
  const tryBlock = stmt.getTryBlock();
  walkBlock(tryBlock, nodeId, ctx, "success");

  // Walk catch block
  if (catchClause) {
    const catchBlock = catchClause.getBlock();
    walkBlock(catchBlock, nodeId, ctx, "error");
  }

  return nodeId;
}

function processReturnStatement(
  stmt: ReturnStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string {
  const nodeId = ctx.nextId("response");
  const returnExpr = stmt.getExpression();
  const returnText = returnExpr?.getText() ?? "";

  // Detect HTTP responses
  const isHttpResponse =
    returnText.includes("NextResponse") ||
    returnText.includes("Response(") ||
    returnText.includes(".json(") ||
    returnText.includes("res.status") ||
    returnText.includes("res.json");

  if (isHttpResponse) {
    const statusMatch = returnText.match(/status[:\s(]+(\d{3})/);
    const bodyMatch = returnText.match(/\.json\((.+?)(?:,|\))/s);

    ctx.addNode({
      id: nodeId,
      nodeType: OutputType.RETURN_RESPONSE,
      category: NodeCategory.OUTPUT,
      label: `Response ${statusMatch?.[1] ?? "200"}`,
      params: {
        statusCode: statusMatch ? parseInt(statusMatch[1]) : 200,
        bodyExpression: bodyMatch?.[1]?.trim() ?? returnText,
      } as ReturnResponseParams,
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    }, line);
  } else {
    ctx.addNode({
      id: nodeId,
      nodeType: OutputType.RETURN_RESPONSE,
      category: NodeCategory.OUTPUT,
      label: "Return",
      params: {
        statusCode: 200,
        bodyExpression: returnText || "undefined",
      } as ReturnResponseParams,
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    }, line);
  }

  trackVariableUses(nodeId, returnText, ctx);
  return nodeId;
}

function processExpressionStatement(
  stmt: ExpressionStatement,
  _prevNodeId: string,
  ctx: DecompileContext,
  line: number
): string | null {
  const expr = stmt.getExpression();
  const exprText = expr.getText();

  // Pattern: await fetch(...) without assignment
  if (isFetchCall(expr)) {
    const nodeId = ctx.nextId("fetch");
    const node = parseFetchNode(nodeId, exprText, undefined);
    ctx.addNode(node, line);
    return nodeId;
  }

  // Pattern: await someAsyncCall(...)
  if (hasAwaitExpression(expr)) {
    const nodeId = ctx.nextId("async_op");
    const awaitedCode = extractAwaitedExpression(expr);
    ctx.addNode({
      id: nodeId,
      nodeType: ActionType.CUSTOM_CODE,
      category: NodeCategory.ACTION,
      label: inferLabel(awaitedCode, undefined),
      params: { code: awaitedCode } as CustomCodeParams,
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    }, line);
    trackVariableUses(nodeId, exprText, ctx);
    return nodeId;
  }

  // Pattern: flowState['x'] = ... (flow2code-generated pattern)
  const flowStateMatch = exprText.match(/flowState\['([^']+)'\]\s*=\s*(.+)/s);
  if (flowStateMatch) {
    return null; // Skip flow2code internal assignments
  }

  // Pattern: res.status(...).json(...) (Express-style response)
  if (exprText.includes("res.status") || exprText.includes("res.json")) {
    const nodeId = ctx.nextId("response");
    const statusMatch = exprText.match(/status\((\d+)\)/);

    ctx.addNode({
      id: nodeId,
      nodeType: OutputType.RETURN_RESPONSE,
      category: NodeCategory.OUTPUT,
      label: `Response ${statusMatch?.[1] ?? "200"}`,
      params: {
        statusCode: statusMatch ? parseInt(statusMatch[1]) : 200,
        bodyExpression: exprText,
      } as ReturnResponseParams,
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    }, line);
    trackVariableUses(nodeId, exprText, ctx);
    return nodeId;
  }

  return null;
}

// ============================================================
// Edge Building (data flow + sequential + control flow)
// ============================================================

function buildEdges(ctx: DecompileContext): void {
  let edgeCounter = 0;
  const addEdge = (source: string, sourcePort: string, target: string, targetPort: string) => {
    // Avoid duplicate edges
    const exists = ctx.edgeList.some(
      (e) => e.sourceNodeId === source && e.targetNodeId === target && e.sourcePortId === sourcePort
    );
    if (exists) return;
    ctx.edgeList.push({
      id: `e${++edgeCounter}`,
      sourceNodeId: source,
      sourcePortId: sourcePort,
      targetNodeId: target,
      targetPortId: targetPort,
    });
  };

  const connectedTargets = new Set<string>();

  // 1. Data flow edges (variable def-use chains)
  for (const [nodeId, uses] of ctx.varUses) {
    for (const use of uses) {
      const def = ctx.varDefs.get(use.varName);
      if (def && def.nodeId !== nodeId) {
        addEdge(def.nodeId, def.portId, nodeId, use.portId);
        connectedTargets.add(nodeId);
      }
    }
  }

  // Helper: resolve target port — use the node's first declared input port id
  const resolveTargetPort = (targetNodeId: string, fallback: string): string => {
    const tgt = ctx.nodes.get(targetNodeId);
    return tgt?.inputs?.[0]?.id ?? fallback;
  };

  // 2. Control flow edges (if/else branches, loop bodies, try/catch)
  for (const [parentId, children] of ctx.controlFlowChildren) {
    for (const child of children) {
      addEdge(parentId, child.portId, child.nodeId, resolveTargetPort(child.nodeId, "input"));
      connectedTargets.add(child.nodeId);
    }
  }

  // 3. Sequential fallback edges (for nodes not yet connected)
  for (const [nodeId, predId] of ctx.seqPredecessors) {
    if (connectedTargets.has(nodeId)) continue;
    const predNode = ctx.nodes.get(predId);
    if (!predNode) continue;
    const sourcePort = predNode.outputs[0]?.id ?? "output";
    addEdge(predId, sourcePort, nodeId, resolveTargetPort(nodeId, "input"));
  }
}

// ============================================================
// Audit Hints
// ============================================================

function computeAuditHints(ctx: DecompileContext): AuditHint[] {
  const hints: AuditHint[] = [...ctx.auditData];

  for (const [nodeId, node] of ctx.nodes) {
    const line = ctx.nodeLines.get(nodeId);

    // Audit: await without try/catch
    if (node.nodeType === ActionType.CUSTOM_CODE || node.nodeType === ActionType.FETCH_API) {
      const isInsideTryCatch = Array.from(ctx.controlFlowChildren.entries()).some(
        ([parentId, children]) => {
          const parent = ctx.nodes.get(parentId);
          return parent?.nodeType === LogicType.TRY_CATCH &&
            children.some((c) => c.nodeId === nodeId);
        }
      );

      // Check sequential ancestors
      let ancestorId = ctx.seqPredecessors.get(nodeId);
      let foundTryCatch = isInsideTryCatch;
      while (ancestorId && !foundTryCatch) {
        const ancestor = ctx.nodes.get(ancestorId);
        if (ancestor?.nodeType === LogicType.TRY_CATCH) foundTryCatch = true;
        // Check if inside any try-catch's control flow
        for (const [parentId, children] of ctx.controlFlowChildren) {
          const parent = ctx.nodes.get(parentId);
          if (parent?.nodeType === LogicType.TRY_CATCH && children.some(c => c.nodeId === nodeId)) {
            foundTryCatch = true;
          }
        }
        ancestorId = ctx.seqPredecessors.get(ancestorId);
      }

      if (!foundTryCatch) {
        hints.push({
          nodeId,
          severity: "warning",
          message: `Async operation "${node.label}" has no error handling (missing try/catch)`,
          line,
        });
      }
    }

    // Audit: fetch without response.ok check
    if (node.nodeType === ActionType.FETCH_API) {
      hints.push({
        nodeId,
        severity: "info",
        message: "Consider checking response.ok or response.status after fetch",
        line,
      });
    }
  }

  return hints;
}

// ============================================================
// Helper Functions
// ============================================================

function isFetchCall(node: TSNode): boolean {
  // AST-based: check if this node or any descendant is a CallExpression calling "fetch"
  if (node.getKind() === SyntaxKind.CallExpression) {
    const expr = (node as CallExpression).getExpression();
    if (expr.getKind() === SyntaxKind.Identifier && expr.getText() === "fetch") return true;
  }
  if (node.getKind() === SyntaxKind.AwaitExpression) {
    return isFetchCall(node.getChildAtIndex(1) ?? node);
  }
  // Check children for nested fetch calls
  return node.forEachChild((child) => isFetchCall(child) || undefined) ?? false;
}

function hasAwaitExpression(node: TSNode): boolean {
  if (node.getKind() === SyntaxKind.AwaitExpression) return true;
  // AST walk: check all descendants for AwaitExpression
  return node.forEachChild((child) => hasAwaitExpression(child) || undefined) ?? false;
}

function extractAwaitedExpression(node: TSNode): string {
  const text = node.getText();
  if (text.startsWith("await ")) return text.slice(6);
  return text;
}

function isSimpleDeclaration(node: TSNode): boolean {
  const text = node.getText();
  // Simple literals, new expressions, or short expressions without await
  return (
    !text.includes("await") &&
    !text.includes("fetch(") &&
    (node.getKind() === SyntaxKind.StringLiteral ||
      node.getKind() === SyntaxKind.NumericLiteral ||
      node.getKind() === SyntaxKind.TrueKeyword ||
      node.getKind() === SyntaxKind.FalseKeyword ||
      node.getKind() === SyntaxKind.NullKeyword ||
      node.getKind() === SyntaxKind.ArrayLiteralExpression ||
      node.getKind() === SyntaxKind.ObjectLiteralExpression ||
      node.getKind() === SyntaxKind.NewExpression)
  );
}

function parseFetchNode(nodeId: string, text: string, varName: string | undefined): FlowNode {
  // Extract URL
  const urlMatch = text.match(/fetch\(([^,)]+)/);
  let url = urlMatch?.[1]?.trim() ?? '""';
  url = url.replace(/^[`"']|[`"']$/g, "");

  // Extract method
  const methodMatch = text.match(/method:\s*["'](\w+)["']/);
  const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as FetchApiParams["method"];

  // Extract headers
  const headerMatch = text.match(/headers:\s*(\{[^}]+\})/);
  let headers: Record<string, string> | undefined;
  if (headerMatch) {
    headers = {};
    const headerPairs = headerMatch[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g);
    for (const pair of headerPairs) {
      headers[pair[1]] = pair[2];
    }
  }

  return {
    id: nodeId,
    nodeType: ActionType.FETCH_API,
    category: NodeCategory.ACTION,
    label: `Fetch ${truncate(url, 30) || varName || "API"}`,
    params: {
      url,
      method,
      headers,
      parseJson: text.includes(".json()"),
    } as FetchApiParams,
    inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
    outputs: [
      { id: "response", label: "Response", dataType: "object" },
      { id: "data", label: "Data", dataType: "any" },
    ],
  };
}

function inferRoutePath(sourceFile: SourceFile): string {
  const filePath = sourceFile.getFilePath();

  // Next.js App Router: /app/api/xxx/route.ts
  const appRouterMatch = filePath.match(/\/app\/api\/(.+?)\/route\.(ts|js)/);
  if (appRouterMatch) return `/api/${appRouterMatch[1]}`;

  // Next.js Pages Router: /pages/api/xxx.ts
  const pagesMatch = filePath.match(/\/pages\/api\/(.+?)\.(ts|js)/);
  if (pagesMatch) return `/api/${pagesMatch[1]}`;

  // Try to find in comments
  const fullText = sourceFile.getFullText();
  const routeMatch = fullText.match(/\/api\/\S+/);
  if (routeMatch) return routeMatch[0];

  return "/api/handler";
}

function inferDataType(tsType: string): "string" | "number" | "boolean" | "object" | "array" | "any" {
  if (tsType.includes("string")) return "string";
  if (tsType.includes("number")) return "number";
  if (tsType.includes("boolean")) return "boolean";
  if (tsType.includes("[]") || tsType.includes("Array")) return "array";
  if (tsType.includes("{") || tsType.includes("Record") || tsType.includes("object")) return "object";
  return "any";
}

function inferLabel(code: string, varName: string | undefined): string {
  // Try to extract a meaningful function call name
  const callMatch = code.match(/^(\w+(?:\.\w+)*)\(/);
  if (callMatch) return callMatch[1];
  if (varName) return varName;
  return truncate(code, 30);
}

function trackVariableUses(nodeId: string, expression: string, ctx: DecompileContext): void {
  // Strip string literals (single/double/backtick) to avoid false-positive identifier matches
  const stripped = expression.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, "");
  // Find identifiers that might reference previously defined variables
  const identifiers = stripped.match(/\b([a-zA-Z_]\w*)\b/g);
  if (!identifiers) return;

  const uses: VariableUse[] = [];
  const seen = new Set<string>();

  for (const ident of identifiers) {
    // Skip keywords, common globals, and type names
    if (SKIP_IDENTIFIERS.has(ident)) continue;
    if (seen.has(ident)) continue;
    seen.add(ident);

    // Only track if this variable has a known definition
    if (ctx.varDefs.has(ident)) {
      // Resolve actual target port — use the node's first declared input port id
      const targetNode = ctx.nodes.get(nodeId);
      const portId = targetNode?.inputs?.[0]?.id ?? "input";
      uses.push({ nodeId, portId, varName: ident });
    }
  }

  if (uses.length > 0) {
    const existing = ctx.varUses.get(nodeId) ?? [];
    ctx.varUses.set(nodeId, [...existing, ...uses]);
  }
}

const SKIP_IDENTIFIERS = new Set([
  // JS keywords
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "throw", "try", "catch", "finally",
  "new", "delete", "typeof", "void", "in", "of", "instanceof", "this", "super",
  "class", "extends", "import", "export", "default", "from", "as", "async", "await",
  "yield", "true", "false", "null", "undefined",
  // Common globals
  "console", "JSON", "Math", "Date", "Error", "Promise", "Array", "Object", "String",
  "Number", "Boolean", "Map", "Set", "RegExp", "Symbol", "Buffer", "process",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "fetch", "Response", "Request", "Headers", "URL", "URLSearchParams",
  "NextResponse", "NextRequest",
  // Common methods
  "log", "error", "warn", "stringify", "parse", "json", "text", "toString",
  "map", "filter", "reduce", "forEach", "find", "some", "every", "includes",
  "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join",
  "keys", "values", "entries", "assign", "freeze",
  "status", "ok", "headers", "body", "method", "url",
  "length", "trim", "split", "replace", "match", "test", "exec",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "then", "catch", "finally",
]);

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
