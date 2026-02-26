/**
 * Flow2Code Dynamic Node Registry
 *
 * 解決「核心與節點過度耦合」問題：
 * 節點定義不再硬編碼在 switch statement 中，
 * 而是透過 `NodeDefinition` 獨立描述，動態註冊。
 *
 * 社區擴展只需：
 * ```ts
 * import { nodeRegistry } from "flow2code/compiler";
 *
 * nodeRegistry.register({
 *   nodeType: "action:s3_upload",
 *   category: NodeCategory.ACTION,
 *   label: "AWS S3 Upload",
 *   icon: "☁️",
 *   description: "上傳檔案到 AWS S3 Bucket",
 *   defaultPorts: {
 *     inputs: [{ id: "file", label: "File", dataType: "object", required: true }],
 *     outputs: [{ id: "url", label: "URL", dataType: "string" }],
 *   },
 *   defaultParams: { bucket: "", region: "us-east-1" },
 * });
 * ```
 */

import {
  type NodeType,
  type NodeCategory,
  type NodeParamsMap,
  type InputPort,
  type OutputPort,
  NodeCategory as NC,
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
} from "@/lib/ir/types";

// ── NodeDefinition 型別 ──

export interface NodeDefinition {
  /** 節點類型識別符（對應 IR 的 nodeType） */
  nodeType: string;
  /** 節點分類 */
  category: NodeCategory;
  /** 顯示標籤 */
  label: string;
  /** Emoji / icon（用於 NodeLibrary） */
  icon: string;
  /** 節點描述（tooltip） */
  description?: string;
  /** 預設端口 */
  defaultPorts: {
    inputs: InputPort[];
    outputs: OutputPort[];
  };
  /** 預設參數 */
  defaultParams: Record<string, unknown>;
  /** 分類在 NodeLibrary 中顯示的群組名稱，省略時自動歸入 category 預設群組 */
  group?: string;
  /** 排序權重（越小越前面），預設 100 */
  order?: number;
}

// ── Registry 實作 ──

export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();

  /** 註冊單個節點定義 */
  register(def: NodeDefinition): void {
    this.definitions.set(def.nodeType, def);
  }

  /** 批次註冊 */
  registerAll(defs: NodeDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  /** 取得單個節點定義 */
  get(nodeType: string): NodeDefinition | undefined {
    return this.definitions.get(nodeType);
  }

  /** 取得所有節點定義 */
  getAll(): NodeDefinition[] {
    return [...this.definitions.values()];
  }

  /** 依分類取得節點定義 */
  getByCategory(category: NodeCategory): NodeDefinition[] {
    return this.getAll().filter((d) => d.category === category);
  }

  /** 取得所有已知的 nodeType 字串 */
  getRegisteredTypes(): string[] {
    return [...this.definitions.keys()];
  }

  /** 是否已註冊 */
  has(nodeType: string): boolean {
    return this.definitions.has(nodeType);
  }

  /** 移除（用於測試或熱重載） */
  unregister(nodeType: string): boolean {
    return this.definitions.delete(nodeType);
  }

  /** 清空全部（用於測試） */
  clear(): void {
    this.definitions.clear();
  }

  // ── 便利方法：與舊 API 相容 ──

  /** 取得節點預設端口（向下相容 getDefaultPorts） */
  getDefaultPorts(nodeType: string): { inputs: InputPort[]; outputs: OutputPort[] } {
    const def = this.definitions.get(nodeType);
    return def?.defaultPorts ?? { inputs: [], outputs: [] };
  }

  /** 取得節點預設參數（向下相容 getDefaultParams） */
  getDefaultParams(nodeType: string): Record<string, unknown> {
    const def = this.definitions.get(nodeType);
    return def?.defaultParams ?? {};
  }

  /** 取得節點預設標籤（向下相容 getDefaultLabel） */
  getDefaultLabel(nodeType: string): string {
    const def = this.definitions.get(nodeType);
    return def?.label ?? "Unknown";
  }

  /** 從節點類型推斷分類（向下相容 getCategoryForType） */
  getCategoryForType(nodeType: string): NodeCategory {
    const def = this.definitions.get(nodeType);
    return def?.category ?? NC.ACTION;
  }

  /**
   * 將節點按 group 分組（用於 NodeLibrary UI）
   * 回傳格式與原始 NodeLibrary.tsx 的 nodeTemplates 相容
   */
  getGroupedDefinitions(): Record<string, {
    icon: string;
    color: string;
    templates: Array<{ nodeType: string; label: string; icon: string; category: NodeCategory }>;
  }> {
    const defaultGroups: Record<string, { icon: string; color: string; name: string }> = {
      [NC.TRIGGER]: { icon: "⚡", color: "text-emerald-400", name: "觸發器" },
      [NC.ACTION]:  { icon: "🔧", color: "text-blue-400",    name: "執行器" },
      [NC.LOGIC]:   { icon: "🔀", color: "text-amber-400",   name: "邏輯控制" },
      [NC.VARIABLE]:{ icon: "📦", color: "text-purple-400",  name: "變數" },
      [NC.OUTPUT]:  { icon: "📤", color: "text-rose-400",    name: "輸出" },
    };

    const groups: Record<string, {
      icon: string;
      color: string;
      templates: Array<{ nodeType: string; label: string; icon: string; category: NodeCategory }>;
    }> = {};

    // 按 order 排序後分組
    const sorted = this.getAll().sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    for (const def of sorted) {
      const groupInfo = defaultGroups[def.category];
      const groupName = def.group ?? groupInfo?.name ?? def.category;

      if (!groups[groupName]) {
        groups[groupName] = {
          icon: groupInfo?.icon ?? "📦",
          color: groupInfo?.color ?? "text-gray-400",
          templates: [],
        };
      }

      groups[groupName].templates.push({
        nodeType: def.nodeType,
        label: def.label,
        icon: def.icon,
        category: def.category,
      });
    }

    return groups;
  }
}

// ── 全域 singleton ──

export const nodeRegistry = new NodeRegistry();

// ── 內建節點定義 ──

const builtinNodeDefinitions: NodeDefinition[] = [
  // ── Triggers ──
  {
    nodeType: TriggerType.HTTP_WEBHOOK,
    category: NC.TRIGGER,
    label: "HTTP Webhook",
    icon: "🌐",
    description: "監聽 HTTP 請求",
    order: 1,
    defaultPorts: {
      inputs: [],
      outputs: [
        { id: "request", label: "Request", dataType: "object" },
        { id: "body", label: "Body", dataType: "object" },
        { id: "query", label: "Query", dataType: "object" },
      ],
    },
    defaultParams: { method: "POST", routePath: "/api/endpoint", parseBody: true },
  },
  {
    nodeType: TriggerType.CRON_JOB,
    category: NC.TRIGGER,
    label: "Cron Job",
    icon: "⏰",
    description: "定時排程觸發",
    order: 2,
    defaultPorts: {
      inputs: [],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    },
    defaultParams: { schedule: "0 * * * *", functionName: "cronHandler" },
  },
  {
    nodeType: TriggerType.MANUAL,
    category: NC.TRIGGER,
    label: "Manual Trigger",
    icon: "👤",
    description: "手動觸發",
    order: 3,
    defaultPorts: {
      inputs: [],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    },
    defaultParams: { functionName: "handler", args: [] },
  },

  // ── Actions ──
  {
    nodeType: ActionType.FETCH_API,
    category: NC.ACTION,
    label: "Fetch API",
    icon: "📡",
    description: "呼叫外部 HTTP API",
    order: 10,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [
        { id: "response", label: "Response", dataType: "object" },
        { id: "data", label: "Data", dataType: "any" },
      ],
    },
    defaultParams: { url: "https://api.example.com", method: "GET", parseJson: true },
  },
  {
    nodeType: ActionType.SQL_QUERY,
    category: NC.ACTION,
    label: "SQL Query",
    icon: "🗄️",
    description: "執行 SQL 查詢",
    order: 11,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "array" }],
    },
    defaultParams: { orm: "drizzle", query: "SELECT * FROM users", params: [] },
  },
  {
    nodeType: ActionType.REDIS_CACHE,
    category: NC.ACTION,
    label: "Redis Cache",
    icon: "💾",
    description: "存取 Redis 快取",
    order: 12,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "value", label: "Value", dataType: "any" }],
    },
    defaultParams: { operation: "get", key: "cache_key" },
  },
  {
    nodeType: ActionType.CUSTOM_CODE,
    category: NC.ACTION,
    label: "Custom Code",
    icon: "💻",
    description: "自訂 TypeScript 程式碼",
    order: 13,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    },
    defaultParams: { code: "// your code here", returnVariable: "result" },
  },
  {
    nodeType: ActionType.CALL_SUBFLOW,
    category: NC.ACTION,
    label: "Call Subflow",
    icon: "🔗",
    description: "呼叫子流程",
    order: 14,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    },
    defaultParams: { flowPath: "./sub-flow", functionName: "subHandler", inputMapping: {} },
  },

  // ── Logic ──
  {
    nodeType: LogicType.IF_ELSE,
    category: NC.LOGIC,
    label: "If / Else",
    icon: "🔀",
    description: "條件分支",
    order: 20,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [
        { id: "true", label: "True", dataType: "any" },
        { id: "false", label: "False", dataType: "any" },
      ],
    },
    defaultParams: { condition: "data !== null" },
  },
  {
    nodeType: LogicType.FOR_LOOP,
    category: NC.LOGIC,
    label: "For Loop",
    icon: "🔁",
    description: "迭代陣列",
    order: 21,
    defaultPorts: {
      inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
      outputs: [
        { id: "item", label: "Item", dataType: "any" },
        { id: "result", label: "Result", dataType: "array" },
      ],
    },
    defaultParams: { iterableExpression: "items", itemVariable: "item" },
  },
  {
    nodeType: LogicType.TRY_CATCH,
    category: NC.LOGIC,
    label: "Try / Catch",
    icon: "🛡️",
    description: "錯誤處理包裝",
    order: 22,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [
        { id: "success", label: "Success", dataType: "any" },
        { id: "error", label: "Error", dataType: "object" },
      ],
    },
    defaultParams: { errorVariable: "error" },
  },
  {
    nodeType: LogicType.PROMISE_ALL,
    category: NC.LOGIC,
    label: "Promise.all",
    icon: "⚡",
    description: "並行執行多個非同步任務",
    order: 23,
    defaultPorts: {
      inputs: [
        { id: "task1", label: "Task 1", dataType: "any", required: true },
        { id: "task2", label: "Task 2", dataType: "any", required: true },
      ],
      outputs: [{ id: "results", label: "Results", dataType: "array" }],
    },
    defaultParams: {},
  },

  // ── Variables ──
  {
    nodeType: VariableType.DECLARE,
    category: NC.VARIABLE,
    label: "Declare Variable",
    icon: "📦",
    description: "宣告變數",
    order: 30,
    defaultPorts: {
      inputs: [],
      outputs: [{ id: "value", label: "Value", dataType: "any" }],
    },
    defaultParams: { name: "myVar", dataType: "string", isConst: true, initialValue: "''" },
  },
  {
    nodeType: VariableType.TRANSFORM,
    category: NC.VARIABLE,
    label: "Transform",
    icon: "🔄",
    description: "轉換資料",
    order: 31,
    defaultPorts: {
      inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
      outputs: [{ id: "output", label: "Output", dataType: "any" }],
    },
    defaultParams: { expression: "input.map(x => x)" },
  },

  // ── Output ──
  {
    nodeType: OutputType.RETURN_RESPONSE,
    category: NC.OUTPUT,
    label: "Return Response",
    icon: "📤",
    description: "回傳 HTTP 回應",
    order: 40,
    defaultPorts: {
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    },
    defaultParams: { statusCode: 200, bodyExpression: "{{$input}}" },
  },
];

// 啟動時自動註冊所有內建節點
nodeRegistry.registerAll(builtinNodeDefinitions);
