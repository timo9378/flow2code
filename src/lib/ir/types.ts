/**
 * Flow2Code Intermediate Representation (IR) Schema
 * 
 * 這是前端畫布與後端 AST 編譯器之間的唯一協議。
 * 所有節點類型、連線、參數皆在此定義。
 * 
 * 設計原則：
 * 1. 與 UI 完全解耦 —— IR 不包含任何座標或樣式資訊
 * 2. 型別安全 —— 每個節點類型都有嚴格的參數定義
 * 3. 可序列化 —— 整個 IR 可以直接 JSON.stringify/parse
 */

// ============================================================
// 版本常數
// ============================================================

/** 目前支援的 IR 版本號 */
export const CURRENT_IR_VERSION = "1.0.0";

// ============================================================
// 基礎型別
// ============================================================

/** 節點唯一識別碼 */
export type NodeId = string;

/** 連線端口識別碼 */
export type PortId = string;

/** 支援的資料型別 */
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
// 端口定義 (Ports)
// ============================================================

/** 輸入端口 */
export interface InputPort {
  id: PortId;
  label: string;
  dataType: FlowDataType;
  required: boolean;
  /** 預設值（JSON 序列化） */
  defaultValue?: string;
}

/** 輸出端口 */
export interface OutputPort {
  id: PortId;
  label: string;
  dataType: FlowDataType;
}

// ============================================================
// 連線定義 (Edges)
// ============================================================

/** 節點之間的資料流連線 */
export interface FlowEdge {
  id: string;
  /** 來源節點 ID */
  sourceNodeId: NodeId;
  /** 來源端口 ID */
  sourcePortId: PortId;
  /** 目標節點 ID */
  targetNodeId: NodeId;
  /** 目標端口 ID */
  targetPortId: PortId;
}

// ============================================================
// 節點類型枚舉
// ============================================================

export enum NodeCategory {
  /** 觸發器：工作流的進入點 */
  TRIGGER = "trigger",
  /** 執行器：產生副作用的操作 */
  ACTION = "action",
  /** 邏輯控制：分支、迴圈、例外處理 */
  LOGIC = "logic",
  /** 變數：定義或轉換資料 */
  VARIABLE = "variable",
  /** 輸出：回傳結果 */
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
// 節點參數定義 (Node Params)
// ============================================================

/** HTTP Webhook 觸發器參數 */
export interface HttpWebhookParams {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 路由路徑，例如 "/api/users" */
  routePath: string;
  /** 是否解析 JSON body */
  parseBody: boolean;
  /** 查詢參數定義 */
  queryParams?: Array<{ name: string; type: FlowDataType; required: boolean }>;
}

/** Cron Job 觸發器參數 */
export interface CronJobParams {
  /** Cron 表達式 */
  schedule: string;
  /** 函數名稱 */
  functionName: string;
}

/** 手動觸發器參數 */
export interface ManualTriggerParams {
  /** 導出的函數名稱 */
  functionName: string;
  /** 函數參數定義 */
  args: Array<{ name: string; type: FlowDataType }>;
}

/** Fetch API 執行器參數 */
export interface FetchApiParams {
  /** 請求 URL（支援環境變數引用，如 ${ENV_VAR}） */
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 請求標頭 */
  headers?: Record<string, string>;
  /** 請求 body（JSON 字串或引用表達式） */
  body?: string;
  /** 是否自動解析 JSON 回應 */
  parseJson: boolean;
}

/** SQL Query 執行器參數 */
export interface SqlQueryParams {
  /** ORM 類型 */
  orm: "drizzle" | "prisma" | "raw";
  /** SQL 或 ORM 查詢語句 */
  query: string;
  /** 查詢參數綁定 */
  params?: Array<{ name: string; value: string }>;
}

/** Redis Cache 執行器參數 */
export interface RedisCacheParams {
  operation: "get" | "set" | "del";
  key: string;
  /** set 操作的值 */
  value?: string;
  /** TTL（秒） */
  ttl?: number;
}

/** 自定義代碼參數 */
export interface CustomCodeParams {
  /** TypeScript 代碼片段 */
  code: string;
  /** 返回值的變數名稱 */
  returnVariable?: string;
  /** 明確指定返回型別（用於型別推斷，例如 "User[]" 或 "{ count: number }"） */
  returnType?: string;
}

/** 子流程呼叫參數 */
export interface CallSubflowParams {
  /** 子流程的導入路徑（結合編譯器生成的檔案） */
  flowPath: string;
  /** 子流程導出的函數名稱 */
  functionName: string;
  /** 輸入參數映射：參數名稱 → 表達式（可使用模板語法） */
  inputMapping: Record<string, string>;
  /** 明確指定子流程返回型別（可選，預設由 TypeScript 推斷） */
  returnType?: string;
}

/** If/Else 邏輯控制參數 */
export interface IfElseParams {
  /** 條件表達式（TypeScript 表達式字串） */
  condition: string;
}

/** For Loop 邏輯控制參數 */
export interface ForLoopParams {
  /** 迭代目標（變數引用表達式） */
  iterableExpression: string;
  /** 迭代變數名稱 */
  itemVariable: string;
  /** 索引變數名稱（可選） */
  indexVariable?: string;
}

/** Try/Catch 邏輯控制參數 */
export interface TryCatchParams {
  /** 錯誤變數名稱 */
  errorVariable: string;
}

/** Promise.all 並發控制參數 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface PromiseAllParams {
  /** 無額外參數，並發任務由連線的子節點決定 */
  [key: string]: never;
}

/** 變數宣告參數 */
export interface DeclareVariableParams {
  /** 變數名稱 */
  name: string;
  /** 變數類型 */
  dataType: FlowDataType;
  /** 初始值表達式 */
  initialValue?: string;
  /** 是否為 const */
  isConst: boolean;
}

/** 資料轉換參數 */
export interface TransformParams {
  /** 轉換表達式（TypeScript 表達式） */
  expression: string;
}

/** 回傳 Response 參數 */
export interface ReturnResponseParams {
  /** HTTP 狀態碼 */
  statusCode: number;
  /** 回傳 body 表達式 */
  bodyExpression: string;
  /** 自定義回傳標頭 */
  headers?: Record<string, string>;
}

// ============================================================
// 節點參數映射表
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
// 核心節點定義
// ============================================================

/** 泛型節點，依據 nodeType 推斷 params 型別 */
export interface FlowNode<T extends NodeType = NodeType> {
  /** 節點唯一識別碼 */
  id: NodeId;
  /** 節點類型 */
  nodeType: T;
  /** 所屬分類 */
  category: NodeCategory;
  /** 使用者標記的節點名稱 */
  label: string;
  /** 節點參數 */
  params: NodeParamsMap[T];
  /** 輸入端口 */
  inputs: InputPort[];
  /** 輸出端口 */
  outputs: OutputPort[];
}

// ============================================================
// Flow IR 文件（頂層結構）
// ============================================================

/** Flow2Code IR 文件 — 畫布與編譯器之間的唯一協議 */
export interface FlowIR {
  /** IR 版本號 */
  version: string;
  /** 工作流摘要 */
  meta: {
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
  };
  /** 所有節點 */
  nodes: FlowNode[];
  /** 所有連線 */
  edges: FlowEdge[];
}

// ============================================================
// 輔助型別
// ============================================================

/** 從 FlowNode 類型提取特定節點 */
export type ExtractNode<T extends NodeType> = FlowNode<T>;

/** 變數引用表達式，用於節點間數據傳遞 */
export interface VariableReference {
  /** 來源節點 ID */
  nodeId: NodeId;
  /** 來源端口 ID */
  portId: PortId;
  /** 表達式路徑，例如 ".data.users[0].name" */
  path?: string;
}
