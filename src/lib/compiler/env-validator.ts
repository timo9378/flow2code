/**
 * Environment Variable Schema Validator
 *
 * Validates at compile time that all environment variables referenced in the IR are declared.
 * Prevents discovering that process.env.XXXXX is undefined only after deployment.
 *
 * Scanning strategy:
 *   1. Scan all string parameters of every node for ${VAR_NAME} patterns
 *   2. Compare against declared environment variables (from .env / .env.example / explicit list)
 *   3. Return warnings for missing / unused environment variables
 */

import type { FlowIR, FlowNode } from "../ir/types";
import { ActionType } from "../ir/types";

// ============================================================
// Public API
// ============================================================

export interface EnvValidationResult {
  /** Whether validation passed (no missing variables) */
  valid: boolean;
  /** All environment variables referenced in the IR */
  usedVars: string[];
  /** Declared but unused environment variables */
  unusedVars: string[];
  /** Referenced but undeclared environment variables */
  missingVars: string[];
  /** Detailed usage report: variable name → reference locations */
  usageMap: Map<string, EnvVarUsage[]>;
}

export interface EnvVarUsage {
  /** Node ID that references this environment variable */
  nodeId: string;
  /** Node label */
  nodeLabel: string;
  /** Parameter name that references this environment variable */
  paramKey: string;
}

// ============================================================
// Env Var Collection
// ============================================================

/** Regex matching ${VAR_NAME} (without process.env. prefix) */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Scan all referenced environment variables from a FlowIR.
 *
 * @param ir - Flow IR
 * @returns Mapping of environment variable names → usage locations
 */
export function collectEnvVars(ir: FlowIR): Map<string, EnvVarUsage[]> {
  const usageMap = new Map<string, EnvVarUsage[]>();

  for (const node of ir.nodes) {
    scanNodeParams(node, usageMap);
  }

  return usageMap;
}

/**
 * Scan all parameters of a single node.
 */
function scanNodeParams(
  node: FlowNode,
  usageMap: Map<string, EnvVarUsage[]>
): void {
  const params = node.params as Record<string, unknown>;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      scanString(value, node, key, usageMap);
    } else if (typeof value === "object" && value !== null) {
      // Recursively scan nested objects (e.g. headers)
      scanObject(value as Record<string, unknown>, node, key, usageMap);
    }
  }
}

function scanString(
  str: string,
  node: FlowNode,
  paramKey: string,
  usageMap: Map<string, EnvVarUsage[]>
): void {
  let match: RegExpExecArray | null;
  // Must reset lastIndex (due to global flag)
  ENV_VAR_PATTERN.lastIndex = 0;
  while ((match = ENV_VAR_PATTERN.exec(str)) !== null) {
    const varName = match[1];
    if (!usageMap.has(varName)) {
      usageMap.set(varName, []);
    }
    usageMap.get(varName)!.push({
      nodeId: node.id,
      nodeLabel: node.label,
      paramKey,
    });
  }
}

function scanObject(
  obj: Record<string, unknown>,
  node: FlowNode,
  parentKey: string,
  usageMap: Map<string, EnvVarUsage[]>
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = `${parentKey}.${key}`;
    if (typeof value === "string") {
      scanString(value, node, fullKey, usageMap);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      scanObject(value as Record<string, unknown>, node, fullKey, usageMap);
    }
  }
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate environment variable references in the IR.
 *
 * @param ir - Flow IR
 * @param declaredVars - List of declared environment variable names
 * @returns Validation result
 */
export function validateEnvVars(
  ir: FlowIR,
  declaredVars: string[]
): EnvValidationResult {
  const usageMap = collectEnvVars(ir);
  const usedVars = [...usageMap.keys()].sort();
  const declaredSet = new Set(declaredVars);

  const missingVars = usedVars.filter((v) => !declaredSet.has(v));
  const unusedVars = declaredVars
    .filter((v) => !usageMap.has(v))
    .sort();

  return {
    valid: missingVars.length === 0,
    usedVars,
    unusedVars,
    missingVars,
    usageMap,
  };
}

// ============================================================
// .env File Parsing
// ============================================================

/**
 * Parse environment variable names from a .env-formatted string.
 * Supported formats:
 *   VAR_NAME=value
 *   VAR_NAME="value"
 *   # comment
 *   export VAR_NAME=value
 */
export function parseEnvFile(content: string): string[] {
  const vars: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Remove export prefix
    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice(7).trim()
      : trimmed;

    // Extract variable name (part before =)
    const eqIndex = withoutExport.indexOf("=");
    if (eqIndex > 0) {
      const varName = withoutExport.slice(0, eqIndex).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
        vars.push(varName);
      }
    }
  }

  return vars;
}

/**
 * Format the validation result into a human-readable report.
 */
export function formatEnvValidationReport(result: EnvValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push(`✅ Environment variable validation passed (${result.usedVars.length} variables)`);
  } else {
    lines.push(`❌ Environment variable validation failed`);
    lines.push("");
    lines.push("Missing environment variables:");
    for (const varName of result.missingVars) {
      const usages = result.usageMap.get(varName) ?? [];
      lines.push(`  ⚠️  ${varName}`);
      for (const usage of usages) {
        lines.push(
          `      → Referenced by "${usage.nodeLabel}" (${usage.nodeId}) in ${usage.paramKey}`
        );
      }
    }
  }

  if (result.unusedVars.length > 0) {
    lines.push("");
    lines.push("💡 Declared but unused environment variables:");
    for (const varName of result.unusedVars) {
      lines.push(`   ${varName}`);
    }
  }

  return lines.join("\n");
}
