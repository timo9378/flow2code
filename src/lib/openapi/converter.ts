/**
 * OpenAPI 3.x → FlowIR 轉換器
 *
 * 將 OpenAPI JSON 規範轉換為多個 FlowIR，
 * 每個 path + method 組合生成一個獨立的 FlowIR。
 */

import type {
  FlowIR,
  FlowNode,
  FlowEdge,
  FlowDataType,
  InputPort,
  OutputPort,
  NodeType,
} from "../ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  OutputType,
} from "../ir/types";

// ============================================================
// OpenAPI 子集型別（只取我們需要的欄位）
// ============================================================

interface OpenAPISpec {
  openapi: string;
  info: { title: string; description?: string; version: string };
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, unknown> };
}

interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: {
    content?: Record<string, { schema?: unknown }>;
    required?: boolean;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: unknown }>;
    }
  >;
  security?: unknown[];
}

interface ParameterObject {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema?: { type?: string; default?: unknown };
  description?: string;
}

// ============================================================
// 轉換結果
// ============================================================

export interface ConvertResult {
  success: boolean;
  flows: FlowIR[];
  errors: string[];
  /** 匯總資訊 */
  summary: {
    totalPaths: number;
    totalOperations: number;
    tags: string[];
  };
}

// ============================================================
// 主轉換函式
// ============================================================

export function convertOpenAPIToFlowIR(jsonInput: string | object): ConvertResult {
  const errors: string[] = [];
  let spec: OpenAPISpec;

  // 1. 解析 JSON
  try {
    spec =
      typeof jsonInput === "string"
        ? (JSON.parse(jsonInput) as OpenAPISpec)
        : (jsonInput as OpenAPISpec);
  } catch (e) {
    return {
      success: false,
      flows: [],
      errors: [`JSON 解析失敗: ${e instanceof Error ? e.message : String(e)}`],
      summary: { totalPaths: 0, totalOperations: 0, tags: [] },
    };
  }

  // 2. 基本驗證
  if (!spec.openapi || !spec.paths) {
    return {
      success: false,
      flows: [],
      errors: ["不是有效的 OpenAPI 規範：缺少 openapi 或 paths 欄位"],
      summary: { totalPaths: 0, totalOperations: 0, tags: [] },
    };
  }

  // 3. 遍歷所有 path + method 組合
  const flows: FlowIR[] = [];
  const allTags = new Set<string>();
  let totalOps = 0;
  const methods: (keyof PathItem)[] = ["get", "post", "put", "patch", "delete"];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      totalOps++;
      operation.tags?.forEach((t) => allTags.add(t));

      try {
        const flow = convertSingleOperation(
          path,
          method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          operation,
          spec
        );
        flows.push(flow);
      } catch (e) {
        errors.push(
          `${method.toUpperCase()} ${path}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  return {
    success: errors.length === 0,
    flows,
    errors,
    summary: {
      totalPaths: Object.keys(spec.paths).length,
      totalOperations: totalOps,
      tags: [...allTags].sort(),
    },
  };
}

// ============================================================
// 單一端點轉換
// ============================================================

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

/** 重置 ID 計數器（測試用） */
export function resetIdCounter(): void {
  idCounter = 0;
}

function convertSingleOperation(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  operation: OperationObject,
  _spec: OpenAPISpec
): FlowIR {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const now = new Date().toISOString();

  const isBodyMethod = ["POST", "PUT", "PATCH"].includes(method);
  const hasRequestBody = isBodyMethod && !!operation.requestBody;
  const hasQueryParams = operation.parameters?.some((p) => p.in === "query");
  const hasPathParams = operation.parameters?.some((p) => p.in === "path");

  // ── 1. Trigger 節點 ──
  const triggerId = nextId("trigger");
  const queryParamsDef = operation.parameters
    ?.filter((p) => p.in === "query")
    .map((p) => ({
      name: p.name,
      type: mapOpenAPIType(p.schema?.type) as FlowDataType,
      required: p.required ?? false,
    }));

  const triggerNode: FlowNode = {
    id: triggerId,
    nodeType: TriggerType.HTTP_WEBHOOK,
    category: NodeCategory.TRIGGER,
    label: `${method} ${path}`,
    params: {
      method,
      routePath: convertPathToNextJS(path),
      parseBody: hasRequestBody,
      ...(queryParamsDef && queryParamsDef.length > 0
        ? { queryParams: queryParamsDef }
        : {}),
    },
    inputs: [],
    outputs: buildTriggerOutputs(method, hasRequestBody, hasQueryParams),
  };
  nodes.push(triggerNode);

  // ── 2. 可選的 Validation / Transform 節點 ──
  let prevNodeId = triggerId;

  // 如果有 path 參數，加一個 Transform 節點來解析
  if (hasPathParams) {
    const transformId = nextId("transform");
    const pathParams = operation.parameters!.filter((p) => p.in === "path");
    const transformNode: FlowNode = {
      id: transformId,
      nodeType: "transform" as NodeType,
      category: NodeCategory.VARIABLE,
      label: "Extract Path Params",
      params: {
        expression: `{ ${pathParams.map((p) => `${p.name}: {{$trigger}}.query.${p.name}`).join(", ")} }`,
      },
      inputs: [
        { id: "input", label: "Input", dataType: "any", required: true },
      ],
      outputs: [{ id: "result", label: "Result", dataType: "object" }],
    };
    nodes.push(transformNode);
    edges.push({
      id: nextId("edge"),
      sourceNodeId: prevNodeId,
      sourcePortId: "request",
      targetNodeId: transformId,
      targetPortId: "input",
    });
    prevNodeId = transformId;
  }

  // ── 3. Return Response 節點 ──
  const responseId = nextId("response");
  const successStatus = getSuccessStatus(operation);

  const responseNode: FlowNode = {
    id: responseId,
    nodeType: OutputType.RETURN_RESPONSE,
    category: NodeCategory.OUTPUT,
    label: operation.summary || `Return ${successStatus}`,
    params: {
      statusCode: successStatus,
      bodyExpression: "{{$input}}",
      headers: { "Content-Type": "application/json" },
    },
    inputs: [
      { id: "data", label: "Data", dataType: "any", required: true },
    ],
    outputs: [],
  };
  nodes.push(responseNode);

  edges.push({
    id: nextId("edge"),
    sourceNodeId: prevNodeId,
    sourcePortId: prevNodeId === triggerId ? "request" : "result",
    targetNodeId: responseId,
    targetPortId: "data",
  });

  return {
    version: "1.0.0",
    meta: {
      name: operation.operationId || `${method} ${path}`,
      description: operation.description || operation.summary || "",
      createdAt: now,
      updatedAt: now,
    },
    nodes,
    edges,
  };
}

// ============================================================
// 輔助函式
// ============================================================

function buildTriggerOutputs(
  method: string,
  hasBody: boolean,
  hasQuery: boolean | undefined
): OutputPort[] {
  const outputs: OutputPort[] = [
    { id: "request", label: "Request", dataType: "object" },
  ];
  if (hasBody) {
    outputs.push({ id: "body", label: "Body", dataType: "object" });
  }
  if (hasQuery) {
    outputs.push({ id: "query", label: "Query", dataType: "object" });
  }
  return outputs;
}

function getSuccessStatus(operation: OperationObject): number {
  if (!operation.responses) return 200;
  const statusCodes = Object.keys(operation.responses);
  const success = statusCodes.find((s) => s.startsWith("2"));
  return success ? parseInt(success, 10) : 200;
}

/**
 * 將 OpenAPI path（/users/{user_id}）轉為 Next.js App Router 路徑
 * /users/{user_id} → /api/users/[user_id]
 */
function convertPathToNextJS(path: string): string {
  // 確保以 /api 開頭
  const apiPath = path.startsWith("/api") ? path : `/api${path}`;
  // 將 {param} 轉為 [param]
  return apiPath.replace(/\{(\w+)\}/g, "[$1]");
}

function mapOpenAPIType(type?: string): string {
  switch (type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    case "string":
    default:
      return "string";
  }
}
