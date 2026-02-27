/**
 * Flow2Code Compiler — Headless Entry Point
 *
 * 這是給外部消費者使用的主要 API。
 * 不依賴 Next.js / React / UI，可在任何 Node.js 環境中獨立運作。
 *
 * @example
 * ```ts
 * import { compile } from "flow2code/compiler";
 *
 * const result = compile(ir, { platform: "nextjs" });
 * if (result.success) {
 *   console.log(result.code);
 * }
 * ```
 */

// ── Core Compiler ──
export { compile, traceLineToNode } from "./compiler/compiler";
export type {
  CompileResult,
  CompileOptions,
  DependencyReport,
  SourceMap,
} from "./compiler/compiler";

// ── IR Types ──
export type {
  FlowIR,
  FlowNode,
  FlowEdge,
  NodeId,
  PortId,
  NodeType,
  InputPort,
  OutputPort,
  FlowDataType,
  HttpWebhookParams,
  CronJobParams,
  ManualTriggerParams,
  FetchApiParams,
  SqlQueryParams,
  RedisCacheParams,
  CustomCodeParams,
  CallSubflowParams,
  IfElseParams,
  ForLoopParams,
  TryCatchParams,
  ReturnResponseParams,
  DeclareVariableParams,
  TransformParams,
} from "./ir/types";
export {
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
  CURRENT_IR_VERSION,
} from "./ir/types";

// ── IR Utilities ──
export { validateFlowIR } from "./ir/validator";
export { validateIRSecurity, formatSecurityReport } from "./ir/security";
export type { SecurityFinding, SecurityCheckResult } from "./ir/security";
export { topologicalSort } from "./ir/topological-sort";
export type { ExecutionPlan, ExecutionStep } from "./ir/topological-sort";

// ── Plugin System ──
export type { NodePlugin, PluginContext, PluginRegistry } from "./compiler/plugins/types";
export {
  registerPlugin,
  registerPlugins,
  getPlugin,
  getAllPlugins,
  clearPlugins,
  hasPlugin,
  createPluginRegistry,
} from "./compiler/plugins/types";
export { builtinPlugins } from "./compiler/plugins/builtin";

// ── Platform System ──
export type { PlatformAdapter, PlatformContext, TriggerInitContext, BuiltinPlatformName } from "./compiler/platforms/types";
export {
  registerPlatform,
  getPlatform,
  getAvailablePlatforms,
} from "./compiler/platforms/types";
export type { PlatformName } from "./compiler/platforms/types";

// ── Expression Parser ──
export { parseExpression } from "./compiler/expression-parser";

// ── Type Inference ──
export { inferFlowStateTypes } from "./compiler/type-inference";

// ── Decompiler (TS → IR) ──
export { decompile } from "./compiler/decompiler";
export type { DecompileResult } from "./compiler/decompiler";

// ── Runtime Error Tracer ──
export {
  traceError,
  formatTraceResults,
  withFlowTrace,
  installFlowTracer,
} from "./compiler/runtime-tracer";
export type { TraceResult, TracerOptions } from "./compiler/runtime-tracer";

// ── Dynamic Node Registry ──
export { NodeRegistry, nodeRegistry } from "./node-registry";
export type { NodeDefinition } from "./node-registry";

// ── Storage (Split YAML / Project) ──
export { splitIR, mergeIR } from "./storage/split-storage";
export type { SplitFiles } from "./storage/split-storage";
export { loadFlowProject, saveFlowProject, migrateToSplit, detectFormat } from "./storage/flow-project";
export type { FlowProjectFormat, SaveOptions, FlowProjectInfo } from "./storage/flow-project";

// ── Diff ──
export { semanticDiff, formatDiff } from "./diff/semantic-diff";
