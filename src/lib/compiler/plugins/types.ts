/**
 * Node Plugin Interface
 *
 * Allows developers to register custom node code generators without modifying compiler source code.
 *
 * Usage example:
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
// Plugin Interface
// ============================================================

export interface PluginContext {
  ir: FlowIR;
  nodeMap: Map<NodeId, FlowNode>;
  envVars: Set<string>;
  imports: Map<string, Set<string>>;
  requiredPackages: Set<string>;
  /** Resolve template expressions (automatically uses expression parser) */
  resolveExpression: (expr: string, currentNodeId?: NodeId) => string;
  /** Resolve environment variable references */
  resolveEnvVars: (url: string) => string;
  /** Generate child node code (used for branching nodes like if/else, try/catch) */
  generateChildNode: (writer: CodeBlockWriter, node: FlowNode) => void;
  /** Get the human-readable variable name for a node (provided by Symbol Table) */
  getVarName: (nodeId: NodeId) => string;
  /**
   * Push a local scope layer.
   * Within this scope, all expression references to nodeId will resolve to scopeVar.
   */
  pushScope: (nodeId: NodeId, scopeVar: string) => void;
  /**
   * Pop the innermost local scope.
   */
  popScope: () => void;
}

export interface NodePlugin {
  /** Node type identifier (corresponds to FlowNode.nodeType) */
  readonly nodeType: string;

  /**
   * Generate TypeScript code for this node.
   */
  generate(
    node: FlowNode,
    writer: CodeBlockWriter,
    context: PluginContext
  ): void;

  /**
   * Declare npm packages required by this node.
   * @returns Array of package names, e.g. ["@aws-sdk/client-ses"]
   */
  getRequiredPackages?(node: FlowNode): string[];

  /**
   * Infer the TypeScript type of this node's output value.
   * Used to generate a typed flowState interface.
   * @returns TypeScript type string, e.g. "{ sent: boolean }"
   */
  getOutputType?(node: FlowNode): string;
}

// ============================================================
// Plugin Registry (supports both global and per-instance modes)
// ============================================================

/**
 * Plugin Registry instance.
 * Each `compile()` call can create an independent registry to avoid global state pollution.
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
 * Create a new Plugin Registry instance.
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

// ── Global registry (backward-compatible, for external registerPlugin usage) ──
const globalRegistry = createPluginRegistry();

/**
 * Register a node plugin (global).
 * If a plugin with the same name already exists, it will be overwritten (allows developers to replace built-in plugins).
 */
export function registerPlugin(plugin: NodePlugin): void {
  globalRegistry.register(plugin);
}

/**
 * Batch-register multiple plugins (global).
 */
export function registerPlugins(plugins: NodePlugin[]): void {
  globalRegistry.registerAll(plugins);
}

/**
 * Get the plugin for a specific node type (global).
 */
export function getPlugin(nodeType: string): NodePlugin | undefined {
  return globalRegistry.get(nodeType);
}

/**
 * Get all registered plugins (global).
 */
export function getAllPlugins(): Map<string, NodePlugin> {
  return globalRegistry.getAll();
}

/**
 * Clear all registered plugins (global, for testing).
 */
export function clearPlugins(): void {
  globalRegistry.clear();
}

/**
 * Check if a specific node type is registered (global).
 */
export function hasPlugin(nodeType: string): boolean {
  return globalRegistry.has(nodeType);
}
