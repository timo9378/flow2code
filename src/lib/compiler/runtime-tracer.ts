/**
 * Flow2Code Runtime Error Tracer
 *
 * Solves the "debugging experience gap" problem:
 * When a compiled API Route throws a runtime error,
 * it automatically intercepts the error stack, reverse-lookups the Source Map,
 * and prints a clickable deep link to jump directly to the error node on the Flow2Code canvas.
 *
 * Usage:
 * ```ts
 * // 1. Next.js middleware / wrap handler
 * import { withFlowTrace } from "flow2code/compiler";
 *
 * export const GET = withFlowTrace(handler, { flowFile: "my-flow.flow.json" });
 *
 * // 2. Global install (intercept uncaught errors)
 * import { installFlowTracer } from "flow2code/compiler";
 *
 * installFlowTracer({ port: 3001 });
 * ```
 *
 * Output example:
 * ```
 * ❌ Runtime Error in generated.ts:45
 *    → Flow2Code Node: [fetch_api_1] "Fetch User Data"
 *    → 🔗 http://localhost:3001?highlight=fetch_api_1
 * ```
 */

import { traceLineToNode } from "./compiler";
import type { SourceMap } from "./compiler";
import type { FlowIR, FlowNode } from "../ir/types";

// ============================================================
// Type Definitions
// ============================================================

export interface TraceResult {
  /** Matched node ID */
  nodeId: string;
  /** Node label */
  nodeLabel: string;
  /** Node type */
  nodeType: string;
  /** Source code line number range */
  startLine: number;
  endLine: number;
  /** Clickable deep link (opens canvas and highlights node) */
  deepLink: string;
}

export interface TracerOptions {
  /** Flow2Code editor URL (default: http://localhost:3001) */
  editorUrl?: string;
  /** Source Map object (if already in memory) */
  sourceMap?: SourceMap;
  /** FlowIR object (used to retrieve node labels) */
  ir?: FlowIR;
  /** Whether to print a readable error message to console (default: true) */
  log?: boolean;
  /** Callback invoked when trace results are available (push to UI store for live badges) */
  onTrace?: (results: TraceResult[], error: Error) => void;
}

// ============================================================
// Core: Reverse-lookup nodes from Error Stack
// ============================================================

/**
 * Extract all matching line numbers from an Error object's stack trace
 * and reverse-lookup the corresponding Flow nodes via Source Map.
 *
 * @param error - Original Error object
 * @param sourceMap - Source Map generated at compile time
 * @param ir - FlowIR (used to retrieve label / nodeType)
 * @param editorUrl - Editor URL
 * @returns All matching TraceResults (in stack order)
 */
export function traceError(
  error: Error,
  sourceMap: SourceMap,
  ir?: FlowIR,
  editorUrl = "http://localhost:3001"
): TraceResult[] {
  const results: TraceResult[] = [];
  if (!error.stack) return results;

  const generatedFile = sourceMap.generatedFile;
  // Match line numbers in stack: at Function (file.ts:45:12) or at file.ts:45:12
  const lineRegex = new RegExp(
    `(?:${escapeRegex(generatedFile)}|generated\\.ts):(\\d+)`,
    "g"
  );

  let match: RegExpExecArray | null;
  const seenNodes = new Set<string>();

  while ((match = lineRegex.exec(error.stack)) !== null) {
    const lineNum = parseInt(match[1], 10);
    const trace = traceLineToNode(sourceMap, lineNum);
    if (trace && !seenNodes.has(trace.nodeId)) {
      seenNodes.add(trace.nodeId);
      const node = ir?.nodes.find((n) => n.id === trace.nodeId);
      results.push({
        nodeId: trace.nodeId,
        nodeLabel: node?.label ?? trace.nodeId,
        nodeType: node?.nodeType ?? "unknown",
        startLine: trace.startLine,
        endLine: trace.endLine,
        deepLink: `${editorUrl}?highlight=${encodeURIComponent(trace.nodeId)}`,
      });
    }
  }

  return results;
}

/**
 * Format TraceResults into a readable console message.
 */
export function formatTraceResults(
  error: Error,
  traces: TraceResult[],
  generatedFile: string
): string {
  if (traces.length === 0) {
    return `❌ ${error.message}\n   (no source map match)`;
  }

  const lines = [`❌ Runtime Error: ${error.message}`];

  for (const t of traces) {
    lines.push(
      `   → Flow Node: [${t.nodeId}] "${t.nodeLabel}" (${t.nodeType})`,
      `   → Lines: ${t.startLine}-${t.endLine} in ${generatedFile}`,
      `   → 🔗 ${t.deepLink}`
    );
  }

  return lines.join("\n");
}

// ============================================================
// Handler Wrapper (for Next.js / Express)
// ============================================================

type AsyncHandler = (...args: unknown[]) => Promise<unknown>;

/**
 * Wrap an API handler to automatically intercept runtime errors and print Flow node traces.
 *
 * @example
 * ```ts
 * import { withFlowTrace } from "flow2code/compiler";
 * import sourceMap from "./my-flow.flow.map.json";
 *
 * async function handler(req: Request) {
 *   // ... generated code
 * }
 *
 * export const GET = withFlowTrace(handler, { sourceMap });
 * ```
 */
export function withFlowTrace<T extends AsyncHandler>(
  handler: T,
  options: TracerOptions
): T {
  const {
    editorUrl = "http://localhost:3001",
    sourceMap,
    ir,
    log = true,
  } = options;

  if (!sourceMap) return handler;

  const wrapped = async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof Error) {
        const traces = traceError(err, sourceMap, ir, editorUrl);
        if (log && traces.length > 0) {
          console.error(
            formatTraceResults(err, traces, sourceMap.generatedFile)
          );
        }
        options.onTrace?.(traces, err);
      }
      throw err; // re-throw — do not swallow the original error
    }
  };

  return wrapped as T;
}

// ============================================================
// Global Tracer Installer
// ============================================================

/**
 * Install the Flow2Code error tracer at the process level.
 * Listens for `uncaughtException` and `unhandledRejection`,
 * automatically printing deep links for errors matching the Source Map.
 *
 * @param options - TracerOptions (must include sourceMap)
 * @returns Cleanup function (uninstall tracer)
 *
 * @example
 * ```ts
 * import { installFlowTracer } from "flow2code/compiler";
 * import sourceMap from "./my-flow.flow.map.json";
 *
 * const uninstall = installFlowTracer({ sourceMap, editorUrl: "http://localhost:3001" });
 *
 * // Later, stop tracing
 * uninstall();
 * ```
 */
export function installFlowTracer(
  options: TracerOptions & { sourceMap: SourceMap }
): () => void {
  const { sourceMap, ir, editorUrl = "http://localhost:3001", log = true } = options;

  const { onTrace } = options as TracerOptions;

  const handleError = (err: unknown) => {
    if (!(err instanceof Error)) return;
    const traces = traceError(err, sourceMap, ir, editorUrl);
    if (log && traces.length > 0) {
      console.error(
        formatTraceResults(err, traces, sourceMap.generatedFile)
      );
    }
    onTrace?.(traces, err);
  };

  process.on("uncaughtException", handleError);
  process.on("unhandledRejection", handleError);

  return () => {
    process.removeListener("uncaughtException", handleError);
    process.removeListener("unhandledRejection", handleError);
  };
}

// ── Helpers ──

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
