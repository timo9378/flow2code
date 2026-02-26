/**
 * Flow2Code Decompiler — TypeScript → FlowIR
 *
 * 反向解析 Flow2Code 編譯器產生的 TypeScript 代碼，
 * 將其還原為 FlowIR 中間表示形式。
 *
 * 策略：
 *   1. Source Map 註解優先：利用編譯器生成的 `// --- node_label [nodeId] ---` 標記
 *   2. AST 分析：使用 ts-morph 解析 TypeScript AST
 *   3. Pattern Matching：識別常見 code pattern（fetch、if/else、for 等）
 *
 * 限制：
 *   - 僅支援 Flow2Code 編譯器生成的代碼（非任意 TypeScript）
 *   - 手動修改後的代碼可能只能部分還原
 *   - 複雜的 custom_code 區塊會作為 opaque 節點保留
 */

import { Project, SyntaxKind, type SourceFile, type Node as TSNode } from "ts-morph";
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
  SqlQueryParams,
  DeclareVariableParams,
  TransformParams,
  CronJobParams,
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
  /** 信心分數 0-1，表示還原準確度 */
  confidence: number;
}

/**
 * 將 Flow2Code 編譯器生成的 TypeScript 代碼反向解析為 FlowIR。
 *
 * @param code - TypeScript 原始碼
 * @param options - 可選設定
 * @returns DecompileResult
 */
export function decompile(
  code: string,
  options: { fileName?: string } = {}
): DecompileResult {
  const errors: string[] = [];
  const { fileName = "route.ts" } = options;

  try {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(fileName, code);

    // Step 1: 嘗試從 Source Map 註解還原
    const sourceMapNodes = extractFromSourceMapComments(code);

    // Step 2: AST 分析
    const astAnalysis = analyzeAST(sourceFile);

    // Step 3: 合併結果
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    let edgeCounter = 0;

    // 解析觸發器
    const trigger = astAnalysis.trigger ?? detectTriggerFromExport(sourceFile);
    if (trigger) {
      nodes.push(trigger);
    } else {
      errors.push("無法偵測到觸發器節點（export function / export default）");
    }

    // 解析 flowState 指派
    const flowStateAssignments = extractFlowStateAssignments(code);

    // 合併 Source Map 節點和 AST 偵測
    const nodeMap = new Map<string, FlowNode>();
    for (const n of sourceMapNodes) {
      nodeMap.set(n.id, n);
    }

    // 從 flowState 指派推斷節點
    for (const assignment of flowStateAssignments) {
      if (nodeMap.has(assignment.nodeId)) continue;

      const node = inferNodeFromAssignment(assignment, code);
      if (node) {
        nodeMap.set(node.id, node);
      }
    }

    // 加入 AST 偵測的 fetch 呼叫
    for (const fetchNode of astAnalysis.fetchCalls) {
      if (!nodeMap.has(fetchNode.id)) {
        nodeMap.set(fetchNode.id, fetchNode);
      }
    }

    // 加入 AST 偵測的 if/else
    for (const ifNode of astAnalysis.ifStatements) {
      if (!nodeMap.has(ifNode.id)) {
        nodeMap.set(ifNode.id, ifNode);
      }
    }

    // 加入 AST 偵測的 for 迴圈
    for (const forNode of astAnalysis.forLoops) {
      if (!nodeMap.has(forNode.id)) {
        nodeMap.set(forNode.id, forNode);
      }
    }

    // 加入 response 節點
    for (const respNode of astAnalysis.responses) {
      if (!nodeMap.has(respNode.id)) {
        nodeMap.set(respNode.id, respNode);
      }
    }

    // 加入所有非觸發器節點
    for (const [, node] of nodeMap) {
      if (node.category !== NodeCategory.TRIGGER) {
        nodes.push(node);
      }
    }

    // 從執行順序推斷邊
    const orderedIds = nodes.map((n) => n.id);
    for (let i = 0; i < orderedIds.length - 1; i++) {
      const sourceNode = nodes.find((n) => n.id === orderedIds[i])!;
      const targetNode = nodes.find((n) => n.id === orderedIds[i + 1])!;

      const sourcePortId = sourceNode.outputs[0]?.id ?? "output";
      const targetPortId = targetNode.inputs[0]?.id ?? "input";

      edges.push({
        id: `e${++edgeCounter}`,
        sourceNodeId: sourceNode.id,
        sourcePortId,
        targetNodeId: targetNode.id,
        targetPortId,
      });
    }

    const now = new Date().toISOString();
    const ir: FlowIR = {
      version: CURRENT_IR_VERSION,
      meta: {
        name: astAnalysis.functionName ?? fileName.replace(/\.(ts|js)$/, ""),
        description: `Decompiled from ${fileName}`,
        createdAt: now,
        updatedAt: now,
      },
      nodes,
      edges,
    };

    // 計算信心分數
    const hasSourceMaps = sourceMapNodes.length > 0;
    const hasAllNodes = nodes.length >= 2; // 至少觸發器 + 一個節點
    const confidence = hasSourceMaps
      ? Math.min(0.95, 0.5 + sourceMapNodes.length * 0.1)
      : hasAllNodes
        ? Math.min(0.7, 0.3 + nodes.length * 0.1)
        : 0.2;

    return { success: true, ir, errors: errors.length > 0 ? errors : undefined, confidence };
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)],
      confidence: 0,
    };
  }
}

// ============================================================
// Source Map Comment Extraction
// ============================================================

function extractFromSourceMapComments(code: string): FlowNode[] {
  const nodes: FlowNode[] = [];
  // 匹配 // --- label [nodeType] [nodeId] --- 格式
  const commentRegex = /\/\/\s*---\s*(.+?)\s+\[([a-z_]+)\]\s+\[([a-zA-Z0-9_]+)\]\s*---/g;
  let match;

  while ((match = commentRegex.exec(code)) !== null) {
    const label = match[1].trim();
    const nodeType = match[2] as NodeType;
    const nodeId = match[3];

    const node = createNodeFromType(nodeId, nodeType, label);
    if (node) nodes.push(node);
  }

  return nodes;
}

// ============================================================
// AST Analysis
// ============================================================

interface ASTAnalysis {
  trigger?: FlowNode;
  fetchCalls: FlowNode[];
  ifStatements: FlowNode[];
  forLoops: FlowNode[];
  responses: FlowNode[];
  functionName?: string;
}

function analyzeAST(sourceFile: SourceFile): ASTAnalysis {
  const result: ASTAnalysis = {
    fetchCalls: [],
    ifStatements: [],
    forLoops: [],
    responses: [],
  };

  let fetchCounter = 0;
  let ifCounter = 0;
  let forCounter = 0;
  let responseCounter = 0;

  // 偵測 export function → HTTP Trigger
  const exportedFunctions = sourceFile.getFunctions().filter((f) => f.isExported());
  for (const fn of exportedFunctions) {
    const name = fn.getName() ?? "";
    const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    if (httpMethods.includes(name.toUpperCase())) {
      result.functionName = name;
      const params = fn.getParameters();
      const hasReqParam = params.some((p) => {
        const typeText = p.getType().getText();
        return typeText.includes("Request") || typeText.includes("NextRequest");
      });

      result.trigger = createTriggerNode(
        "trigger_1",
        name.toUpperCase() as HttpWebhookParams["method"],
        inferRoutePath(sourceFile),
        hasReqParam
      );
      break;
    }
  }

  // 偵測 export default — Cloudflare style
  if (!result.trigger) {
    const exportDefault = sourceFile.getDefaultExportSymbol();
    if (exportDefault) {
      result.trigger = createTriggerNode("trigger_1", "GET", "/", true);
    }
  }

  // 偵測 export async function handler — Express/manual
  if (!result.trigger) {
    for (const fn of exportedFunctions) {
      if (fn.getName() && !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(fn.getName()!.toUpperCase())) {
        result.functionName = fn.getName();
        // 可能是 cron 或 manual
        const fnText = fn.getText();
        if (fnText.includes("cron") || fnText.includes("schedule")) {
          result.trigger = {
            id: "trigger_1",
            nodeType: TriggerType.CRON_JOB,
            category: NodeCategory.TRIGGER,
            label: "Cron Job",
            params: { schedule: "*/5 * * * *", functionName: fn.getName()! } as CronJobParams,
            inputs: [],
            outputs: [{ id: "output", label: "Output", dataType: "any" }],
          };
        } else {
          result.trigger = {
            id: "trigger_1",
            nodeType: TriggerType.MANUAL,
            category: NodeCategory.TRIGGER,
            label: fn.getName() ?? "Manual Trigger",
            params: { functionName: fn.getName()!, args: [] } as ManualTriggerParams,
            inputs: [],
            outputs: [{ id: "output", label: "Output", dataType: "any" }],
          };
        }
        break;
      }
    }
  }

  // 遍歷 AST 尋找 pattern
  sourceFile.forEachDescendant((node) => {
    const kind = node.getKind();

    // Fetch calls
    if (kind === SyntaxKind.CallExpression) {
      const text = node.getText();
      if (text.startsWith("fetch(") || text.startsWith("await fetch(")) {
        fetchCounter++;
        const fetchNode = parseFetchCall(text, `fetch_${fetchCounter}`);
        if (fetchNode) result.fetchCalls.push(fetchNode);
      }
    }

    // If statements
    if (kind === SyntaxKind.IfStatement) {
      ifCounter++;
      const ifText = node.getText();
      const condMatch = ifText.match(/if\s*\((.+?)\)\s*\{/);
      const condition = condMatch?.[1] ?? "true";

      result.ifStatements.push({
        id: `if_${ifCounter}`,
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: `Condition ${ifCounter}`,
        params: { condition } as IfElseParams,
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      });
    }

    // For loops
    if (kind === SyntaxKind.ForOfStatement) {
      forCounter++;
      const forText = node.getText();
      const forMatch = forText.match(/for\s*\(\s*const\s+(\w+)\s+of\s+(.+?)\)\s*\{/);
      result.forLoops.push({
        id: `for_${forCounter}`,
        nodeType: LogicType.FOR_LOOP,
        category: NodeCategory.LOGIC,
        label: `Loop ${forCounter}`,
        params: {
          iterableExpression: forMatch?.[2]?.trim() ?? "[]",
          itemVariable: forMatch?.[1] ?? "item",
        } as ForLoopParams,
        inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
        outputs: [
          { id: "item", label: "Item", dataType: "any" },
          { id: "result", label: "Result", dataType: "array" },
        ],
      });
    }

    // Return responses
    if (kind === SyntaxKind.ReturnStatement) {
      const returnText = node.getText();
      if (returnText.includes("NextResponse.json") || returnText.includes("Response(") || returnText.includes("json(")) {
        responseCounter++;
        const statusMatch = returnText.match(/status:\s*(\d+)/);
        const bodyMatch = returnText.match(/\.json\((.+?)(?:,|\))/s);

        result.responses.push({
          id: `response_${responseCounter}`,
          nodeType: OutputType.RETURN_RESPONSE,
          category: NodeCategory.OUTPUT,
          label: `Response ${responseCounter}`,
          params: {
            statusCode: statusMatch ? parseInt(statusMatch[1]) : 200,
            bodyExpression: bodyMatch?.[1]?.trim() ?? "{}",
          } as ReturnResponseParams,
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [],
        });
      }
    }
  });

  return result;
}

// ============================================================
// Helper Functions
// ============================================================

interface FlowStateAssignment {
  nodeId: string;
  expression: string;
  lineNumber: number;
}

function extractFlowStateAssignments(code: string): FlowStateAssignment[] {
  const assignments: FlowStateAssignment[] = [];
  const regex = /flowState\['([^']+)'\]\s*=\s*(.+?);/g;
  let match;
  const lines = code.split("\n");

  while ((match = regex.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split("\n").length;
    assignments.push({
      nodeId: match[1],
      expression: match[2].trim(),
      lineNumber,
    });
  }

  return assignments;
}

function inferNodeFromAssignment(
  assignment: FlowStateAssignment,
  code: string
): FlowNode | null {
  const { nodeId, expression } = assignment;

  // 跳過觸發器（已經處理）
  if (nodeId.startsWith("trigger")) return null;

  // Custom code: 檢查是否有對應的 Source Map 註解
  // Transform: 簡單賦值
  if (!expression.startsWith("await") && !expression.startsWith("{")) {
    return {
      id: nodeId,
      nodeType: VariableType.TRANSFORM,
      category: NodeCategory.VARIABLE,
      label: nodeId.replace(/_/g, " "),
      params: { expression } as TransformParams,
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    };
  }

  return null;
}

function detectTriggerFromExport(sourceFile: SourceFile): FlowNode | null {
  // Fallback: 如果沒有偵測到任何 trigger，建立一個預設的
  const functions = sourceFile.getFunctions();
  if (functions.length > 0) {
    return {
      id: "trigger_1",
      nodeType: TriggerType.HTTP_WEBHOOK,
      category: NodeCategory.TRIGGER,
      label: "HTTP Webhook Trigger",
      params: {
        method: "GET",
        routePath: "/api/unknown",
        parseBody: false,
      } as HttpWebhookParams,
      inputs: [],
      outputs: [
        { id: "request", label: "Request", dataType: "object" },
        { id: "body", label: "Body", dataType: "object" },
        { id: "query", label: "Query", dataType: "object" },
      ],
    };
  }
  return null;
}

function createTriggerNode(
  id: string,
  method: HttpWebhookParams["method"],
  routePath: string,
  parseBody: boolean
): FlowNode {
  return {
    id,
    nodeType: TriggerType.HTTP_WEBHOOK,
    category: NodeCategory.TRIGGER,
    label: "HTTP Webhook Trigger",
    params: { method, routePath, parseBody: parseBody && method !== "GET" } as HttpWebhookParams,
    inputs: [],
    outputs: [
      { id: "request", label: "Request", dataType: "object" },
      { id: "body", label: "Body", dataType: "object" },
      { id: "query", label: "Query", dataType: "object" },
    ],
  };
}

function inferRoutePath(sourceFile: SourceFile): string {
  // 嘗試從檔案路徑推斷
  const filePath = sourceFile.getFilePath();
  const apiMatch = filePath.match(/\/app\/api\/(.+?)\/route\.(ts|js)/);
  if (apiMatch) return `/api/${apiMatch[1]}`;

  // 嘗試從註解推斷
  const fullText = sourceFile.getFullText();
  const routeMatch = fullText.match(/\/api\/\S+/);
  if (routeMatch) return routeMatch[0];

  return "/api/unknown";
}

function parseFetchCall(text: string, nodeId: string): FlowNode | null {
  // 提取 URL
  const urlMatch = text.match(/fetch\(([^,)]+)/);
  let url = urlMatch?.[1]?.trim() ?? '""';
  // 去除外層引號或模板字面量符號
  url = url.replace(/^[`"']|[`"']$/g, "");

  // 提取 method
  const methodMatch = text.match(/method:\s*["'](\w+)["']/);
  const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as FetchApiParams["method"];

  // 提取 headers
  const headerMatch = text.match(/headers:\s*(\{[^}]+\})/);
  let headers: Record<string, string> | undefined;
  if (headerMatch) {
    try {
      // 簡化解析
      headers = {};
      const headerPairs = headerMatch[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g);
      for (const pair of headerPairs) {
        headers[pair[1]] = pair[2];
      }
    } catch {
      // ignore
    }
  }

  return {
    id: nodeId,
    nodeType: ActionType.FETCH_API,
    category: NodeCategory.ACTION,
    label: `Fetch ${nodeId.replace(/_/g, " ")}`,
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

function createNodeFromType(
  id: string,
  nodeType: NodeType,
  label: string
): FlowNode | null {
  const portMap: Record<string, { inputs: InputPort[]; outputs: OutputPort[] }> = {
    [TriggerType.HTTP_WEBHOOK]: {
      inputs: [],
      outputs: [
        { id: "request", label: "Request", dataType: "object" },
        { id: "body", label: "Body", dataType: "object" },
        { id: "query", label: "Query", dataType: "object" },
      ],
    },
    [TriggerType.CRON_JOB]: {
      inputs: [],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    },
    [TriggerType.MANUAL]: {
      inputs: [],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    },
    [ActionType.FETCH_API]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [
        { id: "response", label: "Response", dataType: "object" },
        { id: "data", label: "Data", dataType: "any" },
      ],
    },
    [ActionType.SQL_QUERY]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "array" }],
    },
    [ActionType.REDIS_CACHE]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "value", label: "Value", dataType: "any" }],
    },
    [ActionType.CUSTOM_CODE]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    },
    [ActionType.CALL_SUBFLOW]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    },
    [LogicType.IF_ELSE]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [
        { id: "true", label: "True", dataType: "any" },
        { id: "false", label: "False", dataType: "any" },
      ],
    },
    [LogicType.FOR_LOOP]: {
      inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
      outputs: [
        { id: "item", label: "Item", dataType: "any" },
        { id: "result", label: "Result", dataType: "array" },
      ],
    },
    [LogicType.TRY_CATCH]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [
        { id: "success", label: "Success", dataType: "any" },
        { id: "error", label: "Error", dataType: "object" },
      ],
    },
    [VariableType.DECLARE]: {
      inputs: [],
      outputs: [{ id: "value", label: "Value", dataType: "any" }],
    },
    [VariableType.TRANSFORM]: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    },
    [OutputType.RETURN_RESPONSE]: {
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    },
  };

  const ports = portMap[nodeType];
  if (!ports) return null;

  const categoryMap: Record<string, NodeCategory> = {
    http_webhook: NodeCategory.TRIGGER,
    cron_job: NodeCategory.TRIGGER,
    manual: NodeCategory.TRIGGER,
    fetch_api: NodeCategory.ACTION,
    sql_query: NodeCategory.ACTION,
    redis_cache: NodeCategory.ACTION,
    custom_code: NodeCategory.ACTION,
    call_subflow: NodeCategory.ACTION,
    if_else: NodeCategory.LOGIC,
    for_loop: NodeCategory.LOGIC,
    try_catch: NodeCategory.LOGIC,
    promise_all: NodeCategory.LOGIC,
    declare: NodeCategory.VARIABLE,
    transform: NodeCategory.VARIABLE,
    return_response: NodeCategory.OUTPUT,
  };

  const defaultParams: Record<string, unknown> = {
    [TriggerType.HTTP_WEBHOOK]: { method: "GET", routePath: "/api/unknown", parseBody: false },
    [TriggerType.CRON_JOB]: { schedule: "*/5 * * * *", functionName: "job" },
    [TriggerType.MANUAL]: { functionName: "main", args: [] },
    [ActionType.FETCH_API]: { url: "", method: "GET", parseJson: true },
    [ActionType.SQL_QUERY]: { orm: "raw", query: "" },
    [ActionType.REDIS_CACHE]: { operation: "get", key: "" },
    [ActionType.CUSTOM_CODE]: { code: "" },
    [ActionType.CALL_SUBFLOW]: { flowPath: "", functionName: "", inputMapping: {} },
    [LogicType.IF_ELSE]: { condition: "true" },
    [LogicType.FOR_LOOP]: { iterableExpression: "[]", itemVariable: "item" },
    [LogicType.TRY_CATCH]: { errorVariable: "error" },
    [VariableType.DECLARE]: { name: "value", dataType: "any", isConst: true },
    [VariableType.TRANSFORM]: { expression: "" },
    [OutputType.RETURN_RESPONSE]: { statusCode: 200, bodyExpression: "{}" },
  };

  return {
    id,
    nodeType,
    category: categoryMap[nodeType] ?? NodeCategory.ACTION,
    label,
    params: (defaultParams[nodeType] ?? {}) as FlowNode["params"],
    inputs: ports.inputs,
    outputs: ports.outputs,
  };
}
