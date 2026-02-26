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
export {
  parseExpression,
  ExpressionParseError,
  type ScopeEntry,
} from "./expression-parser";

// ── Type Inference ──
export { inferFlowStateTypes } from "./type-inference";

// ── Symbol Table ──
export {
  buildSymbolTable,
  labelToVarName,
  type SymbolTable,
} from "./symbol-table";

// ── Environment Variable Validation ──
export {
  collectEnvVars,
  validateEnvVars,
  parseEnvFile,
  formatEnvValidationReport,
  type EnvValidationResult,
  type EnvVarUsage,
} from "./env-validator";
