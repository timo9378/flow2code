/**
 * AI-Generated IR Security Check
 *
 * When IR is produced by AI/LLM, custom_code nodes may contain malicious code.
 * This module intercepts at the "load/import" stage, earlier than the compile-time `DANGEROUS_CODE_PATTERNS`.
 *
 * @example
 * ```ts
 * import { validateIRSecurity } from "flow2code/compiler";
 *
 * const result = validateIRSecurity(aiGeneratedIR);
 * if (!result.safe) {
 *   console.warn("⚠️ Dangerous patterns:", result.findings);
 * }
 * ```
 */

import type { FlowIR, FlowNode, NodeId } from "./types";
import { ActionType } from "./types";

// ── Types ──

export interface SecurityFinding {
  /** Severity level */
  severity: "critical" | "warning" | "info";
  /** Node ID */
  nodeId: NodeId;
  /** Node label */
  nodeLabel: string;
  /** Description of the detected pattern */
  pattern: string;
  /** Matched code snippet (truncated to 80 characters) */
  match: string;
}

export interface SecurityCheckResult {
  /** Whether it is safe (no critical findings) */
  safe: boolean;
  /** All detection results */
  findings: SecurityFinding[];
  /** Number of nodes scanned */
  nodesScanned: number;
}

// ── Dangerous Patterns ──

interface DangerousPattern {
  pattern: RegExp;
  desc: string;
  severity: SecurityFinding["severity"];
}

/**
 * Dangerous code pattern list
 *
 * Three severity levels:
 * - critical: Direct threat to system security (RCE, file deletion, etc.)
 * - warning: Potential security risk (dynamic import, network communication, etc.)
 * - info: Worth noting but not necessarily dangerous
 */
const SECURITY_PATTERNS: DangerousPattern[] = [
  // ── Critical: Remote Code Execution / System Access ──
  { pattern: /\beval\s*\(/, desc: "eval() — dynamically executes arbitrary code", severity: "critical" },
  { pattern: /\bnew\s+Function\s*\(/, desc: "new Function() — dynamically constructs a function", severity: "critical" },
  { pattern: /\bchild_process\b/, desc: "child_process — can execute arbitrary system commands", severity: "critical" },
  { pattern: /\bexec\s*\(/, desc: "exec() — executes shell commands", severity: "critical" },
  { pattern: /\bexecSync\s*\(/, desc: "execSync() — synchronously executes shell commands", severity: "critical" },
  { pattern: /\bspawn\s*\(/, desc: "spawn() — spawns a child process", severity: "critical" },
  { pattern: /\bprocess\.exit\b/, desc: "process.exit() — terminates the Node.js process", severity: "critical" },
  { pattern: /\bprocess\.env\b/, desc: "process.env — accesses environment variables (may leak secrets)", severity: "critical" },
  { pattern: /\bprocess\.kill\b/, desc: "process.kill() — kills a process", severity: "critical" },
  { pattern: /\brequire\s*\(\s*['"`]child_process/, desc: "require('child_process')", severity: "critical" },
  { pattern: /\brequire\s*\(\s*['"`]vm['"`]/, desc: "require('vm') — V8 virtual machine", severity: "critical" },

  // ── Critical: File System Destructive ──
  { pattern: /\bfs\.\w*(unlink|rmdir|rm|rmSync|unlinkSync)\b/, desc: "fs delete operation", severity: "critical" },
  { pattern: /\bfs\.\w*(writeFile|writeFileSync|appendFile)\b/, desc: "fs write operation", severity: "critical" },
  { pattern: /\brequire\s*\(\s*['"`]fs['"`]\)/, desc: "require('fs') — file system access", severity: "critical" },

  // ── Warning: Network / Dynamic Import ──
  { pattern: /\bimport\s*\(/, desc: "dynamic import() — can load arbitrary modules", severity: "warning" },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]/, desc: "require('http/https') — network module", severity: "warning" },
  { pattern: /\brequire\s*\(\s*['"`]net['"`]/, desc: "require('net') — low-level network access", severity: "warning" },
  { pattern: /\bglobalThis\b/, desc: "globalThis — accesses the global scope", severity: "warning" },
  { pattern: /\b__proto__\b/, desc: "__proto__ — prototype pollution risk", severity: "warning" },
  { pattern: /\bconstructor\s*\[\s*['"`]/, desc: "constructor[] — prototype pollution risk", severity: "warning" },

  // ── Warning: FS Read (non-destructive but sensitive) ──
  { pattern: /\brequire\s*\(\s*['"`]fs['"`]\s*\)\.read/, desc: "fs read operation", severity: "warning" },
  { pattern: /\bfs\.\w*(readFile|readFileSync|readdir)\b/, desc: "fs read operation", severity: "warning" },

  // ── Info: Uncommon patterns ──
  { pattern: /\bsetTimeout\s*\(\s*[^,]+,\s*\d{5,}/, desc: "long setTimeout (>10s) — possibly a malicious delay", severity: "info" },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, desc: "while(true) — possible infinite loop", severity: "info" },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, desc: "for(;;) — possible infinite loop", severity: "info" },
];

// ── Core Scanner ──

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

/**
 * Scan code strings of a single node
 */
function scanCode(
  nodeId: NodeId,
  nodeLabel: string,
  code: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const { pattern, desc, severity } of SECURITY_PATTERNS) {
    // Use a fresh regex with global flag to find ALL matches
    const globalPattern = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(code)) !== null) {
      findings.push({
        severity,
        nodeId,
        nodeLabel,
        pattern: desc,
        match: truncate(match[0], 80),
      });
    }
  }

  return findings;
}

/**
 * Extract executable code strings from a FlowNode
 * Currently scans:
 * - custom_code.code
 * - transform.expression
 * - All params fields that may contain suspicious strings
 */
function extractCodeFields(node: FlowNode): string[] {
  const codes: string[] = [];
  const params = node.params as Record<string, unknown> | undefined;

  if (!params) return codes;

  // custom_code's code field
  if (node.nodeType === ActionType.CUSTOM_CODE && typeof params.code === "string") {
    codes.push(params.code);
  }

  // transform's expression field
  if (typeof params.expression === "string") {
    codes.push(params.expression);
  }

  // call_subflow's inputMapping (may contain code hidden in JSON strings)
  if (typeof params.inputMapping === "string") {
    codes.push(params.inputMapping);
  } else if (typeof params.inputMapping === "object" && params.inputMapping !== null) {
    codes.push(JSON.stringify(params.inputMapping));
  }

  // body field (fetch_api, etc.)
  if (typeof params.body === "string") {
    codes.push(params.body);
  }

  // String interpolation in SQL queries
  if (typeof params.query === "string") {
    codes.push(params.query);
  }

  // bodyExpression (return_response)
  if (typeof params.bodyExpression === "string") {
    codes.push(params.bodyExpression);
  }

  // condition (if_else)
  if (typeof params.condition === "string") {
    codes.push(params.condition);
  }

  return codes;
}

// ── Public API ──

/**
 * Validate the security of all nodes in a FlowIR
 *
 * Specifically targets AI/LLM-generated IR, detecting malicious patterns at the load/import stage.
 * Scan scope: custom_code, transform, if_else, return_response, fetch_api, and all other fields containing code/expressions.
 *
 * @param ir - The FlowIR to check
 * @returns SecurityCheckResult - Contains safety verdict, all detection findings, and scan statistics
 */
export function validateIRSecurity(ir: FlowIR): SecurityCheckResult {
  const findings: SecurityFinding[] = [];
  let nodesScanned = 0;

  for (const node of ir.nodes) {
    const codeFields = extractCodeFields(node);
    if (codeFields.length === 0) continue;

    nodesScanned++;

    for (const code of codeFields) {
      const nodeFindings = scanCode(node.id, node.label ?? node.id, code);
      findings.push(...nodeFindings);
    }
  }

  const hasCritical = findings.some((f) => f.severity === "critical");

  return {
    safe: !hasCritical,
    findings,
    nodesScanned,
  };
}

/**
 * Format security check results into a human-readable string
 */
export function formatSecurityReport(result: SecurityCheckResult): string {
  if (result.findings.length === 0) {
    return `✅ Security check passed (scanned ${result.nodesScanned} nodes, no dangerous patterns detected)`;
  }

  const lines: string[] = [];
  const critical = result.findings.filter((f) => f.severity === "critical");
  const warnings = result.findings.filter((f) => f.severity === "warning");
  const infos = result.findings.filter((f) => f.severity === "info");

  lines.push(`⚠️ Security check results (scanned ${result.nodesScanned} nodes)`);
  lines.push("");

  if (critical.length > 0) {
    lines.push(`🔴 Critical (${critical.length}):`);
    for (const f of critical) {
      lines.push(`  [${f.nodeId}] ${f.pattern} — match: "${f.match}"`);
    }
  }

  if (warnings.length > 0) {
    lines.push(`🟡 Warning (${warnings.length}):`);
    for (const f of warnings) {
      lines.push(`  [${f.nodeId}] ${f.pattern} — match: "${f.match}"`);
    }
  }

  if (infos.length > 0) {
    lines.push(`🔵 Info (${infos.length}):`);
    for (const f of infos) {
      lines.push(`  [${f.nodeId}] ${f.pattern} — match: "${f.match}"`);
    }
  }

  return lines.join("\n");
}
