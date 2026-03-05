/**
 * Platform Adapter Interface
 *
 * Abstracts HTTP framework implementations so the compiler is no longer coupled to Next.js.
 * Developers can choose different target platforms to generate corresponding code.
 *
 * Supported platforms:
 *   - nextjs       (default) Next.js App Router
 *   - express      Express.js
 *   - cloudflare   Cloudflare Workers
 *   - generic      Generic TypeScript (pure functions, framework-agnostic)
 */

import type { SourceFile, CodeBlockWriter } from "ts-morph";
import type { FlowNode, NodeId, FlowIR } from "../../ir/types";
import type { SymbolTable } from "../symbol-table";

// ============================================================
// Platform Adapter Interface
// ============================================================

export interface PlatformAdapter {
  /** Platform name */
  readonly name: string;

  /**
   * Generate import statements.
   * e.g. Next.js: `import { NextResponse } from "next/server"`
   */
  generateImports(
    sourceFile: SourceFile,
    trigger: FlowNode,
    context: PlatformContext
  ): void;

  /**
   * Generate the exported main function (including signature, parameters, outer try/catch).
   * The bodyGenerator callback is responsible for filling in the function body logic.
   */
  generateFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    context: PlatformContext,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void;

  /**
   * Generate code that returns a Response.
   */
  generateResponse(
    writer: CodeBlockWriter,
    bodyExpr: string,
    statusCode: number,
    headers?: Record<string, string>
  ): void;

  /**
   * Generate the error response code for the global error handler.
   */
  generateErrorResponse(writer: CodeBlockWriter): void;

  /**
   * Generate initialization code based on trigger type (parse request body/query, etc.).
   * Each platform uses its own HTTP API (Next.js / Express / Cloudflare Workers).
   */
  generateTriggerInit(
    writer: CodeBlockWriter,
    trigger: FlowNode,
    context: TriggerInitContext
  ): void;

  /**
   * Get the output file path.
   */
  getOutputFilePath(trigger: FlowNode): string;

  /**
   * Implicit npm dependencies for this platform.
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

/**
 * Built-in platform names (extensible: third parties can register any string via registerPlatform).
 */
export type BuiltinPlatformName = "nextjs" | "express" | "cloudflare";
export type PlatformName = BuiltinPlatformName | (string & {});

const platformRegistry = new Map<string, () => PlatformAdapter>();

/**
 * Create an isolated platform registry instance.
 * Useful for testing or concurrent compilation with different platform sets.
 */
export function createPlatformRegistry() {
  const registry = new Map<string, () => PlatformAdapter>();
  return {
    register(name: PlatformName, factory: () => PlatformAdapter): void {
      registry.set(name, factory);
    },
    get(name: PlatformName): PlatformAdapter {
      const factory = registry.get(name);
      if (!factory) {
        throw new Error(
          `Unknown platform "${name}". Available: ${[...registry.keys()].join(", ")}`
        );
      }
      return factory();
    },
    available(): string[] {
      return [...registry.keys()];
    },
  };
}

/**
 * Register a custom platform adapter.
 *
 * Allows users to extend the compiler's supported target platforms (e.g. Fastify, Koa, etc.).
 * The factory function is lazily invoked on each compile to avoid global state pollution.
 *
 * @param name - Platform name, can use a built-in name or a custom string
 * @param factory - Platform adapter factory function
 *
 * @example
 * ```ts
 * import { registerPlatform } from "flow2code";
 *
 * registerPlatform("fastify", () => ({
 *   imports: () => ['import Fastify from "fastify";'],
 *   routeWrapper: (method, path, body) => `app.${method}("${path}", async (req, reply) => {\n${body}\n});`,
 *   response: (statusExpr, bodyExpr) => `reply.status(${statusExpr}).send(${bodyExpr});`,
 *   appSetup: () => 'const app = Fastify();',
 *   listen: (port) => `app.listen({ port: ${port} });`,
 * }));
 * ```
 */
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
      `Unknown platform "${name}". Available platforms: ${[...platformRegistry.keys()].join(", ")}`
    );
  }
  return factory();
}

export function getAvailablePlatforms(): string[] {
  return [...platformRegistry.keys()];
}
