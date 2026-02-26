/**
 * Platform Adapter 介面
 *
 * 將 HTTP 框架的具體實作抽象化，讓編譯器不再耦合 Next.js。
 * 開發者可以選擇不同的目標平台來生成對應的代碼。
 *
 * 支援的平台：
 *   - nextjs       (預設) Next.js App Router
 *   - express      Express.js
 *   - cloudflare   Cloudflare Workers
 *   - generic      通用 TypeScript（純函式，不綁框架）
 */

import type { SourceFile, CodeBlockWriter } from "ts-morph";
import type { FlowNode, NodeId, FlowIR } from "../../ir/types";
import type { SymbolTable } from "../symbol-table";

// ============================================================
// Platform Adapter 介面
// ============================================================

export interface PlatformAdapter {
  /** 平台名稱 */
  readonly name: string;

  /**
   * 生成 import 語句
   * 例如 Next.js: `import { NextResponse } from "next/server"`
   */
  generateImports(
    sourceFile: SourceFile,
    trigger: FlowNode,
    context: PlatformContext
  ): void;

  /**
   * 生成導出的主函式（包含簽名、參數、外層 try/catch）
   * bodyGenerator 回呼負責填入函式內部邏輯。
   */
  generateFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    context: PlatformContext,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void;

  /**
   * 生成回傳 Response 的代碼
   */
  generateResponse(
    writer: CodeBlockWriter,
    bodyExpr: string,
    statusCode: number,
    headers?: Record<string, string>
  ): void;

  /**
   * 生成全域錯誤攔截的回傳代碼
   */
  generateErrorResponse(writer: CodeBlockWriter): void;

  /**
   * 根據觸發器類型生成初始化代碼（解析 request body/query 等）
   * 每個平台使用自己的 HTTP API（Next.js / Express / Cloudflare Workers）。
   */
  generateTriggerInit(
    writer: CodeBlockWriter,
    trigger: FlowNode,
    context: TriggerInitContext
  ): void;

  /**
   * 取得輸出檔案路徑
   */
  getOutputFilePath(trigger: FlowNode): string;

  /**
   * 此平台隱含的 npm 依賴
   */
  getImplicitDependencies(): string[];
}

// ============================================================
// Platform Context
// ============================================================

export interface PlatformContext {
  ir: FlowIR;
  nodeMap: Map<NodeId, FlowNode>;
  envVars: Set<string>;
  imports: Map<string, Set<string>>;
}

export interface TriggerInitContext {
  symbolTable: SymbolTable;
}

// ============================================================
// Platform Registry
// ============================================================

export type PlatformName = "nextjs" | "express" | "cloudflare" | "generic";

const platformRegistry = new Map<PlatformName, () => PlatformAdapter>();

export function registerPlatform(
  name: PlatformName,
  factory: () => PlatformAdapter
): void {
  platformRegistry.set(name, factory);
}

export function getPlatform(name: PlatformName): PlatformAdapter {
  const factory = platformRegistry.get(name);
  if (!factory) {
    throw new Error(
      `未知的平台 "${name}"。可用平台: ${[...platformRegistry.keys()].join(", ")}`
    );
  }
  return factory();
}

export function getAvailablePlatforms(): PlatformName[] {
  return [...platformRegistry.keys()];
}
