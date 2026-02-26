/**
 * Node Plugin 介面
 *
 * 讓開發者可以註冊自定義節點代碼生成器，無需修改編譯器 Source Code。
 *
 * 使用範例：
 * ```ts
 * import { registerPlugin } from "flow2code/compiler";
 *
 * registerPlugin({
 *   nodeType: "aws_ses_email",
 *   generate(node, writer, context) {
 *     writer.writeLine(`await ses.sendEmail({ ... });`);
 *     writer.writeLine(`flowState['${node.id}'] = { sent: true };`);
 *   },
 *   getRequiredPackages: () => ["@aws-sdk/client-ses"],
 *   getOutputType: () => "{ sent: boolean }",
 * });
 * ```
 */

import type { CodeBlockWriter } from "ts-morph";
import type { FlowNode, NodeType, NodeId, FlowIR } from "../../ir/types";
import type { ScopeEntry } from "../expression-parser";

// ============================================================
// Plugin 介面
// ============================================================

export interface PluginContext {
  ir: FlowIR;
  nodeMap: Map<NodeId, FlowNode>;
  envVars: Set<string>;
  imports: Map<string, Set<string>>;
  requiredPackages: Set<string>;
  /** 解析模板表達式（自動使用 expression parser） */
  resolveExpression: (expr: string, currentNodeId?: NodeId) => string;
  /** 解析環境變數引用 */
  resolveEnvVars: (url: string) => string;
  /** 生成子節點代碼（用於 if/else, try/catch 等分支節點） */
  generateChildNode: (writer: CodeBlockWriter, node: FlowNode) => void;
  /** 取得節點的人類可讀變數名稱（由 Symbol Table 提供） */
  getVarName: (nodeId: NodeId) => string;
  /**
   * 推入一層局部作用域
   * 在此作用域內，所有對 nodeId 的表達式引用都會解析到 scopeVar
   */
  pushScope: (nodeId: NodeId, scopeVar: string) => void;
  /**
   * 彈出最內層的局部作用域
   */
  popScope: () => void;
}

export interface NodePlugin {
  /** 節點類型識別碼（對應 FlowNode.nodeType） */
  readonly nodeType: string;

  /**
   * 生成此節點的 TypeScript 代碼
   */
  generate(
    node: FlowNode,
    writer: CodeBlockWriter,
    context: PluginContext
  ): void;

  /**
   * 聲明此節點需要的 npm 套件
   * @returns 套件名稱陣列，例如 ["@aws-sdk/client-ses"]
   */
  getRequiredPackages?(node: FlowNode): string[];

  /**
   * 推斷此節點輸出值的 TypeScript 型別
   * 用於生成具型別的 flowState interface
   * @returns TypeScript 型別字串，例如 "{ sent: boolean }"
   */
  getOutputType?(node: FlowNode): string;
}

// ============================================================
// Plugin Registry（支援全域 + per-instance 兩種模式）
// ============================================================

/**
 * Plugin Registry 實例。
 * 每個 `compile()` 呼叫可建立獨立的 registry，避免全域狀態汙染。
 */
export interface PluginRegistry {
  register(plugin: NodePlugin): void;
  registerAll(plugins: NodePlugin[]): void;
  get(nodeType: string): NodePlugin | undefined;
  has(nodeType: string): boolean;
  getAll(): Map<string, NodePlugin>;
  clear(): void;
}

/**
 * 建立一個全新的 Plugin Registry 實例
 */
export function createPluginRegistry(): PluginRegistry {
  const map = new Map<string, NodePlugin>();
  return {
    register(plugin) { map.set(plugin.nodeType, plugin); },
    registerAll(plugins) { for (const p of plugins) map.set(p.nodeType, p); },
    get(nodeType) { return map.get(nodeType); },
    has(nodeType) { return map.has(nodeType); },
    getAll() { return new Map(map); },
    clear() { map.clear(); },
  };
}

// ── 全域 registry（向後相容，供外部 registerPlugin 使用） ──
const globalRegistry = createPluginRegistry();

/**
 * 註冊一個節點 Plugin（全域）
 * 如果已存在同名 Plugin，會覆蓋（允許開發者替換內建 Plugin）
 */
export function registerPlugin(plugin: NodePlugin): void {
  globalRegistry.register(plugin);
}

/**
 * 批次註冊多個 Plugin（全域）
 */
export function registerPlugins(plugins: NodePlugin[]): void {
  globalRegistry.registerAll(plugins);
}

/**
 * 取得指定節點類型的 Plugin（全域）
 */
export function getPlugin(nodeType: string): NodePlugin | undefined {
  return globalRegistry.get(nodeType);
}

/**
 * 取得所有已註冊的 Plugin（全域）
 */
export function getAllPlugins(): Map<string, NodePlugin> {
  return globalRegistry.getAll();
}

/**
 * 清除所有已註冊的 Plugin（全域，用於測試）
 */
export function clearPlugins(): void {
  globalRegistry.clear();
}

/**
 * 檢查是否已註冊特定節點類型（全域）
 */
export function hasPlugin(nodeType: string): boolean {
  return globalRegistry.has(nodeType);
}
