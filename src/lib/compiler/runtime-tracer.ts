/**
 * Flow2Code Runtime Error Tracer
 *
 * 解決「除錯體驗斷層」問題：
 * 當編譯生成的 API Route 在 Runtime 報錯時，
 * 自動攔截 Error Stack，反查 Source Map，
 * 印出可點擊的 deep link 直接跳轉到 Flow2Code 畫布中的錯誤節點。
 *
 * 使用方式：
 * ```ts
 * // 1. Next.js middleware / 包裝 handler
 * import { withFlowTrace } from "flow2code/compiler";
 *
 * export const GET = withFlowTrace(handler, { flowFile: "my-flow.flow.json" });
 *
 * // 2. 全域安裝（攔截 uncaught errors）
 * import { installFlowTracer } from "flow2code/compiler";
 *
 * installFlowTracer({ port: 3001 });
 * ```
 *
 * 輸出範例：
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
// 型別定義
// ============================================================

export interface TraceResult {
  /** 匹配到的節點 ID */
  nodeId: string;
  /** 節點標籤 */
  nodeLabel: string;
  /** 節點類型 */
  nodeType: string;
  /** 原始碼行號範圍 */
  startLine: number;
  endLine: number;
  /** 可點擊的 deep link（開啟畫布並高亮節點） */
  deepLink: string;
}

export interface TracerOptions {
  /** Flow2Code 編輯器 URL（預設 http://localhost:3001） */
  editorUrl?: string;
  /** Source Map 物件（若已在記憶體中） */
  sourceMap?: SourceMap;
  /** FlowIR 物件（用於取得節點 label） */
  ir?: FlowIR;
  /** 是否在 console 印出可讀的錯誤訊息（預設 true） */
  log?: boolean;
}

// ============================================================
// 核心：從 Error Stack 反查節點
// ============================================================

/**
 * 從 Error 物件的 stack trace 中提取所有匹配的行號，
 * 並透過 Source Map 反查對應的 Flow 節點。
 *
 * @param error - 原始 Error 物件
 * @param sourceMap - 編譯時產生的 Source Map
 * @param ir - FlowIR（用於取得 label / nodeType）
 * @param editorUrl - 編輯器 URL
 * @returns 所有匹配的 TraceResult（按 stack order）
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
  // 匹配 stack 中的行號：at Function (file.ts:45:12) 或 at file.ts:45:12
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
 * 格式化 TraceResult 為可讀的 console 訊息
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
// Handler 包裝器（Next.js / Express 適用）
// ============================================================

type AsyncHandler = (...args: unknown[]) => Promise<unknown>;

/**
 * 包裝 API handler，自動攔截 Runtime Error 並印出 Flow 節點追蹤。
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
      }
      throw err; // re-throw — 不吃掉原始錯誤
    }
  };

  return wrapped as T;
}

// ============================================================
// 全域 Tracer 安裝器
// ============================================================

/**
 * 在 process 層級安裝 Flow2Code error tracer。
 * 會監聽 `uncaughtException` 和 `unhandledRejection`，
 * 將匹配 Source Map 的錯誤自動印出 deep link。
 *
 * @param options - TracerOptions（必須包含 sourceMap）
 * @returns 清除函數（uninstall tracer）
 *
 * @example
 * ```ts
 * import { installFlowTracer } from "flow2code/compiler";
 * import sourceMap from "./my-flow.flow.map.json";
 *
 * const uninstall = installFlowTracer({ sourceMap, editorUrl: "http://localhost:3001" });
 *
 * // 稍後停止追蹤
 * uninstall();
 * ```
 */
export function installFlowTracer(
  options: TracerOptions & { sourceMap: SourceMap }
): () => void {
  const { sourceMap, ir, editorUrl = "http://localhost:3001", log = true } = options;

  const handleError = (err: unknown) => {
    if (!(err instanceof Error)) return;
    const traces = traceError(err, sourceMap, ir, editorUrl);
    if (log && traces.length > 0) {
      console.error(
        formatTraceResults(err, traces, sourceMap.generatedFile)
      );
    }
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
