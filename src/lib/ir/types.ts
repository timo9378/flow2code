/**
 * Flow2Code Intermediate Representation (IR) Schema
 * 
 * This is the sole contract between the visual canvas and the AST compiler.
 * All node types, edges, and parameters are defined here.
 * 
 * Design principles:
 * 1. Fully decoupled from UI — IR contains no coordinate or style information
 * 2. Type-safe — each node type has strictly typed parameters
 * 3. Serializable — entire IR can be directly JSON.stringify/parse
 */

// ============================================================
// Version Constants
// ============================================================

/** Current supported IR version number */
export const CURRENT_IR_VERSION = "1.0.0";

// ============================================================
// Base Types
// ============================================================

/** Node unique identifier */
export type NodeId = string;

/** Port identifier */
export type PortId = string;

/** Supported data types */
export type FlowDataType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any"
  | "void"
  | "Response";

// ============================================================
// Port Definitions
// ============================================================

/** Input port */
export interface InputPort {
  id: PortId;
  label: string;
  dataType: FlowDataType;
  required: boolean;
  /** Default value (JSON serialized) */
  defaultValue?: string;
}

/** Output port */
export interface OutputPort {
  id: PortId;
  label: string;
  dataType: FlowDataType;
}

// ============================================================
// Edge Definitions
// ============================================================

/** Data flow connection between nodes */
export interface FlowEdge {
  id: string;
  /** Source node ID */
  sourceNodeId: NodeId;
  /** Source port ID */
  sourcePortId: PortId;
  /** Target node ID */
  targetNodeId: NodeId;
  /** Target port ID */
  targetPortId: PortId;
}

// ============================================================
// Node Type Enums
// ============================================================

export enum NodeCategory {
  /** Trigger: workflow entry point */
  TRIGGER = "trigger",
  /** Action: side-effect producing operation */
  ACTION = "action",
  /** Logic: branching, loops, exception handling */
  LOGIC = "logic",
  /** Variable: define or transform data */
  VARIABLE = "variable",
  /** Output: return result */
  OUTPUT = "output",
}

export enum TriggerType {
  HTTP_WEBHOOK = "http_webhook",
  CRON_JOB = "cron_job",
  MANUAL = "manual",
}

export enum ActionType {
  FETCH_API = "fetch_api",
  SQL_QUERY = "sql_query",
  REDIS_CACHE = "redis_cache",
  CUSTOM_CODE = "custom_code",
  CALL_SUBFLOW = "call_subflow",
}

export enum LogicType {
  IF_ELSE = "if_else",
  FOR_LOOP = "for_loop",
  TRY_CATCH = "try_catch",
  PROMISE_ALL = "promise_all",
}

export enum VariableType {
  DECLARE = "declare",
  TRANSFORM = "transform",
}

export enum OutputType {
  RETURN_RESPONSE = "return_response",
}

// ============================================================
// Node Parameter Definitions
// ============================================================

/** HTTP Webhook trigger parameters */
export interface HttpWebhookParams {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Route path, e.g. "/api/users" */
  routePath: string;
  /** Whether to parse JSON body */
  parseBody: boolean;
  /** Query parameter definitions */
  queryParams?: Array<{ name: string; type: FlowDataType; required: boolean }>;
}

/** Cron Job trigger parameters */
export interface CronJobParams {
  /** Cron expression */
  schedule: string;
  /** Function name */
  functionName: string;
}

/** Manual trigger parameters */
export interface ManualTriggerParams {
  /** Exported function name */
  functionName: string;
  /** Function parameter definitions */
  args: Array<{ name: string; type: FlowDataType }>;
}

/** Fetch API action parameters */
export interface FetchApiParams {
  /** Request URL (supports env var references like ${ENV_VAR}) */
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (JSON string or reference expression) */
  body?: string;
  /** Whether to auto-parse JSON response */
  parseJson: boolean;
}

/** SQL Query action parameters */
export interface SqlQueryParams {
  /** ORM type */
  orm: "drizzle" | "prisma" | "raw";
  /** SQL or ORM query statement */
  query: string;
  /** Query parameter bindings */
  params?: Array<{ name: string; value: string }>;
}

/** Redis Cache action parameters */
export interface RedisCacheParams {
  operation: "get" | "set" | "del";
  key: string;
  /** Value for set operation */
  value?: string;
  /** TTL (seconds) */
  ttl?: number;
}

/** Custom code parameters */
export interface CustomCodeParams {
  /** TypeScript code snippet */
  code: string;
  /** Name of the return variable */
  returnVariable?: string;
  /** Explicitly specify the return type (for type inference, e.g. "User[]" or "{ count: number }") */
  returnType?: string;
}

/** Subflow call parameters */
export interface CallSubflowParams {
  /** Import path of the subflow (combined with compiler-generated file) */
  flowPath: string;
  /** Exported function name of the subflow */
  functionName: string;
  /** Input parameter mapping: param name → expression (supports template syntax) */
  inputMapping: Record<string, string>;
  /** Explicit subflow return type (optional, defaults to TypeScript inference) */
  returnType?: string;
}

/** If/Else logic control parameters */
export interface IfElseParams {
  /** Condition expression (TypeScript expression string) */
  condition: string;
}

/** For Loop logic control parameters */
export interface ForLoopParams {
  /** Iteration target (variable reference expression) */
  iterableExpression: string;
  /** Iterator variable name */
  itemVariable: string;
  /** Index variable name (optional) */
  indexVariable?: string;
}

/** Try/Catch logic control parameters */
export interface TryCatchParams {
  /** Error variable name */
  errorVariable: string;
}

/** Promise.all concurrency control parameters */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface PromiseAllParams {
  /** No additional params. Concurrent tasks are determined by connected child nodes */
  [key: string]: never;
}

/** Variable declaration parameters */
export interface DeclareVariableParams {
  /** Variable name */
  name: string;
  /** Variable type */
  dataType: FlowDataType;
  /** Initial value expression */
  initialValue?: string;
  /** Whether const */
  isConst: boolean;
}

/** Data transform parameters */
export interface TransformParams {
  /** Transform expression (TypeScript expression) */
  expression: string;
}

/** Return Response parameters */
export interface ReturnResponseParams {
  /** HTTP status code */
  statusCode: number;
  /** Response body expression */
  bodyExpression: string;
  /** Custom response headers */
  headers?: Record<string, string>;
}

// ============================================================
// Node Params Map
// ============================================================

export interface NodeParamsMap {
  // Triggers
  [TriggerType.HTTP_WEBHOOK]: HttpWebhookParams;
  [TriggerType.CRON_JOB]: CronJobParams;
  [TriggerType.MANUAL]: ManualTriggerParams;
  // Actions
  [ActionType.FETCH_API]: FetchApiParams;
  [ActionType.SQL_QUERY]: SqlQueryParams;
  [ActionType.REDIS_CACHE]: RedisCacheParams;
  [ActionType.CUSTOM_CODE]: CustomCodeParams;
  [ActionType.CALL_SUBFLOW]: CallSubflowParams;
  // Logic
  [LogicType.IF_ELSE]: IfElseParams;
  [LogicType.FOR_LOOP]: ForLoopParams;
  [LogicType.TRY_CATCH]: TryCatchParams;
  [LogicType.PROMISE_ALL]: PromiseAllParams;
  // Variable
  [VariableType.DECLARE]: DeclareVariableParams;
  [VariableType.TRANSFORM]: TransformParams;
  // Output
  [OutputType.RETURN_RESPONSE]: ReturnResponseParams;
}

export type NodeType = keyof NodeParamsMap;

// ============================================================
// Core Node Definition
// ============================================================

/** Generic node, params type inferred from nodeType */
export interface FlowNode<T extends NodeType = NodeType> {
  /** Node unique identifier */
  id: NodeId;
  /** Node type */
  nodeType: T;
  /** Category */
  category: NodeCategory;
  /** User-defined node label */
  label: string;
  /** Node parameters */
  params: NodeParamsMap[T];
  /** Input ports */
  inputs: InputPort[];
  /** Output ports */
  outputs: OutputPort[];
}

// ============================================================
// Flow IR Document (Top-level structure)
// ============================================================

/** Flow2Code IR Document — the sole contract between canvas and compiler */
export interface FlowIR {
  /** IR version */
  version: string;
  /** Workflow summary */
  meta: {
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
  };
  /** All nodes */
  nodes: FlowNode[];
  /** All edges */
  edges: FlowEdge[];
}

// ============================================================
// Helper Types
// ============================================================

/** Extract a specific node type from FlowNode */
export type ExtractNode<T extends NodeType> = FlowNode<T>;

/** Variable reference expression for cross-node data passing */
export interface VariableReference {
  /** Source node ID */
  nodeId: NodeId;
  /** Source port ID */
  portId: PortId;
  /** Expression path, e.g. ".data.users[0].name" */
  path?: string;
}
