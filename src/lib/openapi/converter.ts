/**
 * OpenAPI 3.x → FlowIR Converter
 *
 * Converts an OpenAPI JSON specification into multiple FlowIRs,
 * generating an independent FlowIR for each path + method combination.
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
// OpenAPI Subset Types (only fields we need)
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
// Conversion Result
// ============================================================

export interface ConvertResult {
  success: boolean;
  flows: FlowIR[];
  errors: string[];
  /** Summary information */
  summary: {
    totalPaths: number;
    totalOperations: number;
    tags: string[];
  };
}

// ============================================================
// Main Conversion Function
// ============================================================

export function convertOpenAPIToFlowIR(jsonInput: string | object): ConvertResult {
  // Reset ID counter for each invocation to ensure deterministic results
  idCounter = 0;

  const errors: string[] = [];
  let spec: OpenAPISpec;

  // 1. Parse JSON
  try {
    spec =
      typeof jsonInput === "string"
        ? (JSON.parse(jsonInput) as OpenAPISpec)
        : (jsonInput as OpenAPISpec);
  } catch (e) {
    return {
      success: false,
      flows: [],
      errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
      summary: { totalPaths: 0, totalOperations: 0, tags: [] },
    };
  }

  // 2. Basic validation
  if (!spec.openapi || !spec.paths) {
    return {
      success: false,
      flows: [],
      errors: ["Not a valid OpenAPI spec: missing openapi or paths field"],
      summary: { totalPaths: 0, totalOperations: 0, tags: [] },
    };
  }

  // 3. Iterate all path + method combinations
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
// Single Endpoint Conversion
// ============================================================

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

/** Reset ID counter (for testing) */
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

  // ── 1. Trigger Node ──
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

  // ── 2. Optional Validation / Transform Nodes ──
  let prevNodeId = triggerId;

  // If path params exist, add a Transform node to parse them
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

  // ── 3. Return Response Node ──
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
// Helper Functions
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
 * Convert OpenAPI path (/users/{user_id}) to Next.js App Router path
 * /users/{user_id} → /api/users/[user_id]
 */
function convertPathToNextJS(path: string): string {
  // Ensure it starts with /api
  const apiPath = path.startsWith("/api") ? path : `/api${path}`;
  // Convert {param} to [param]
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
