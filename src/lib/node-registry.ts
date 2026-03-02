/**
 * Flow2Code Dynamic Node Registry
 *
 * Solves the "core and nodes over-coupling" problem:
 * Node definitions are no longer hardcoded in switch statements,
 * but independently described via `NodeDefinition` and dynamically registered.
 *
 * Community extensions simply need to:
 * ```ts
 * import { nodeRegistry } from "flow2code/compiler";
 *
 * nodeRegistry.register({
 *   nodeType: "action:s3_upload",
 *   category: NodeCategory.ACTION,
 *   label: "AWS S3 Upload",
 *   icon: "☁️",
 *   description: "Upload file to AWS S3 Bucket",
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

// ── NodeDefinition Type ──

export interface NodeDefinition {
  /** Node type identifier (corresponds to IR's nodeType) */
  nodeType: string;
  /** Node category */
  category: NodeCategory;
  /** Display label */
  label: string;
  /** Emoji / icon (for NodeLibrary) */
  icon: string;
  /** Node description (tooltip) */
  description?: string;
  /** Default ports */
  defaultPorts: {
    inputs: InputPort[];
    outputs: OutputPort[];
  };
  /** Default parameters */
  defaultParams: Record<string, unknown>;
  /** Group name displayed in NodeLibrary; defaults to category group if omitted */
  group?: string;
  /** Sort weight (lower = higher priority), default 100 */
  order?: number;
}

// ── Registry Implementation ──

export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();

  /** Register a single node definition */
  register(def: NodeDefinition): void {
    this.definitions.set(def.nodeType, def);
  }

  /** Batch register */
  registerAll(defs: NodeDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  /** Get a single node definition */
  get(nodeType: string): NodeDefinition | undefined {
    return this.definitions.get(nodeType);
  }

  /** Get all node definitions */
  getAll(): NodeDefinition[] {
    return [...this.definitions.values()];
  }

  /** Get node definitions by category */
  getByCategory(category: NodeCategory): NodeDefinition[] {
    return this.getAll().filter((d) => d.category === category);
  }

  /** Get all registered nodeType strings */
  getRegisteredTypes(): string[] {
    return [...this.definitions.keys()];
  }

  /** Check if registered */
  has(nodeType: string): boolean {
    return this.definitions.has(nodeType);
  }

  /** Remove (for testing or hot reload) */
  unregister(nodeType: string): boolean {
    return this.definitions.delete(nodeType);
  }

  /** Clear all (for testing) */
  clear(): void {
    this.definitions.clear();
  }

  // ── Convenience methods: backward-compatible with old API ──

  /** Get node default ports (backward-compatible with getDefaultPorts) */
  getDefaultPorts(nodeType: string): { inputs: InputPort[]; outputs: OutputPort[] } {
    const def = this.definitions.get(nodeType);
    return def?.defaultPorts ?? { inputs: [], outputs: [] };
  }

  /** Get node default parameters (backward-compatible with getDefaultParams) */
  getDefaultParams(nodeType: string): Record<string, unknown> {
    const def = this.definitions.get(nodeType);
    return def?.defaultParams ?? {};
  }

  /** Get node default label (backward-compatible with getDefaultLabel) */
  getDefaultLabel(nodeType: string): string {
    const def = this.definitions.get(nodeType);
    return def?.label ?? "Unknown";
  }

  /** Infer category from node type (backward-compatible with getCategoryForType) */
  getCategoryForType(nodeType: string): NodeCategory {
    const def = this.definitions.get(nodeType);
    return def?.category ?? NC.ACTION;
  }

  /**
   * Group nodes by group (for NodeLibrary UI)
   * Return format is compatible with the original NodeLibrary.tsx nodeTemplates
   */
  getGroupedDefinitions(): Record<string, {
    icon: string;
    color: string;
    templates: Array<{ nodeType: string; label: string; icon: string; category: NodeCategory }>;
  }> {
    const defaultGroups: Record<string, { icon: string; color: string; name: string }> = {
      [NC.TRIGGER]: { icon: "⚡", color: "text-emerald-400", name: "Triggers" },
      [NC.ACTION]:  { icon: "🔧", color: "text-blue-400",    name: "Actions" },
      [NC.LOGIC]:   { icon: "🔀", color: "text-amber-400",   name: "Logic Control" },
      [NC.VARIABLE]:{ icon: "📦", color: "text-purple-400",  name: "Variables" },
      [NC.OUTPUT]:  { icon: "📤", color: "text-rose-400",    name: "Output" },
    };

    const groups: Record<string, {
      icon: string;
      color: string;
      templates: Array<{ nodeType: string; label: string; icon: string; category: NodeCategory }>;
    }> = {};

    // Sort by order then group
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

// ── Global singleton ──

export const nodeRegistry = new NodeRegistry();

// ── Built-in node definitions ──

const builtinNodeDefinitions: NodeDefinition[] = [
  // ── Triggers ──
  {
    nodeType: TriggerType.HTTP_WEBHOOK,
    category: NC.TRIGGER,
    label: "HTTP Webhook",
    icon: "🌐",
    description: "Listen for HTTP requests",
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
    description: "Scheduled cron trigger",
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
    description: "Manual trigger",
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
    description: "Call external HTTP API",
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
    description: "Execute SQL query",
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
    description: "Access Redis cache",
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
    description: "Custom TypeScript code",
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
    description: "Call subflow",
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
    description: "Conditional branch",
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
    description: "Iterate array",
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
    description: "Error handling wrapper",
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
    description: "Execute multiple async tasks in parallel",
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
    description: "Declare variable",
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
    description: "Transform data",
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
    description: "Return HTTP response",
    order: 40,
    defaultPorts: {
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    },
    defaultParams: { statusCode: 200, bodyExpression: "{{$input}}" },
  },
];

// Auto-register all built-in nodes on startup
nodeRegistry.registerAll(builtinNodeDefinitions);
