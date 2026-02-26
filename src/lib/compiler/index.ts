export {
  compile,
  traceLineToNode,
  type CompileResult,
  type CompileOptions,
  type DependencyReport,
  type SourceMap,
} from "./compiler";

// ── Platform Adapter System ──
export {
  type PlatformAdapter,
  type PlatformName,
  registerPlatform,
  getPlatform,
  getAvailablePlatforms,
} from "./platforms/index";

// ── Plugin System ──
export {
  type NodePlugin,
  type PluginContext,
  registerPlugin,
  registerPlugins,
  getPlugin,
  clearPlugins,
} from "./plugins/index";

// ── Expression Parser ──
export { parseExpression, ExpressionParseError } from "./expression-parser";

// ── Type Inference ──
export { inferFlowStateTypes } from "./type-inference";
