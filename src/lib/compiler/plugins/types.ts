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
// Plugin Registry
// ============================================================

const pluginRegistry = new Map<string, NodePlugin>();

/**
 * 註冊一個節點 Plugin
 * 如果已存在同名 Plugin，會覆蓋（允許開發者替換內建 Plugin）
 */
export function registerPlugin(plugin: NodePlugin): void {
  pluginRegistry.set(plugin.nodeType, plugin);
}

/**
 * 批次註冊多個 Plugin
 */
export function registerPlugins(plugins: NodePlugin[]): void {
  for (const plugin of plugins) {
    registerPlugin(plugin);
  }
}

/**
 * 取得指定節點類型的 Plugin
 */
export function getPlugin(nodeType: string): NodePlugin | undefined {
  return pluginRegistry.get(nodeType);
}

/**
 * 取得所有已註冊的 Plugin
 */
export function getAllPlugins(): Map<string, NodePlugin> {
  return new Map(pluginRegistry);
}

/**
 * 清除所有已註冊的 Plugin（用於測試）
 */
export function clearPlugins(): void {
  pluginRegistry.clear();
}

/**
 * 檢查是否已註冊特定節點類型
 */
export function hasPlugin(nodeType: string): boolean {
  return pluginRegistry.has(nodeType);
}
