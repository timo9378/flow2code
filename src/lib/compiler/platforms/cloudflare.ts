/**
 * Cloudflare Workers Platform Adapter
 *
 * Generates request handler code compatible with Cloudflare Workers.
 */

import type { SourceFile, CodeBlockWriter } from "ts-morph";
import type { FlowNode } from "../../ir/types";
import { TriggerType } from "../../ir/types";
import type { PlatformAdapter, PlatformContext, TriggerInitContext } from "./types";
import type {
  HttpWebhookParams,
  CronJobParams,
  ManualTriggerParams,
} from "../../ir/types";

export class CloudflarePlatform implements PlatformAdapter {
  readonly name = "cloudflare";

  generateImports(
    _sourceFile: SourceFile,
    _trigger: FlowNode,
    _context: PlatformContext
  ): void {
    // Cloudflare Workers uses global Web APIs, no additional imports needed
  }

  generateFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    _context: PlatformContext,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    switch (trigger.nodeType) {
      case TriggerType.HTTP_WEBHOOK:
        this.generateFetchHandler(sourceFile, trigger, bodyGenerator);
        break;
      case TriggerType.CRON_JOB:
        this.generateScheduledHandler(sourceFile, trigger, bodyGenerator);
        break;
      case TriggerType.MANUAL:
        this.generateManualFunction(sourceFile, trigger, bodyGenerator);
        break;
      default:
        throw new Error(`Unsupported trigger type: ${trigger.nodeType}`);
    }
  }

  generateResponse(
    writer: CodeBlockWriter,
    bodyExpr: string,
    statusCode: number,
    headers?: Record<string, string>
  ): void {
    const headersObj = headers && Object.keys(headers).length > 0
      ? `, { status: ${statusCode}, headers: ${JSON.stringify({ "Content-Type": "application/json", ...headers })} }`
      : `, { status: ${statusCode}, headers: { "Content-Type": "application/json" } }`;
    writer.writeLine(
      `return new Response(JSON.stringify(${bodyExpr})${headersObj});`
    );
  }

  generateErrorResponse(writer: CodeBlockWriter): void {
    writer.writeLine('console.error("Workflow failed:", error);');
    writer.writeLine(
      `return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json" } });`
    );
  }

  getOutputFilePath(trigger: FlowNode): string {
    if (trigger.nodeType === TriggerType.HTTP_WEBHOOK) {
      return "src/worker.ts";
    }
    if (trigger.nodeType === TriggerType.CRON_JOB) {
      const params = trigger.params as CronJobParams;
      return `src/scheduled/${params.functionName}.ts`;
    }
    if (trigger.nodeType === TriggerType.MANUAL) {
      const params = trigger.params as ManualTriggerParams;
      return `src/functions/${params.functionName}.ts`;
    }
    return "src/generated/flow.ts";
  }

  getImplicitDependencies(): string[] {
    return ["@cloudflare/workers-types"];
  }

  generateTriggerInit(
    writer: CodeBlockWriter,
    trigger: FlowNode,
    context: TriggerInitContext
  ): void {
    const varName = context.symbolTable.getVarName(trigger.id);

    switch (trigger.nodeType) {
      case TriggerType.HTTP_WEBHOOK: {
        const params = trigger.params as HttpWebhookParams;
        const isGetOrDelete = ["GET", "DELETE"].includes(params.method);

        if (isGetOrDelete) {
          writer.writeLine(
            "const url = new URL(request.url);"
          );
          writer.writeLine(
            "const query = Object.fromEntries(url.searchParams.entries());"
          );
          writer.writeLine(
            `const ${varName} = { query, url: request.url };`
          );
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        } else if (
          params.parseBody &&
          ["POST", "PUT", "PATCH"].includes(params.method)
        ) {
          writer.writeLine("let body: unknown;");
          writer.write("try ").block(() => {
            writer.writeLine("body = await request.json();");
          });
          writer.write(" catch ").block(() => {
            writer.writeLine(
              'return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });'
            );
          });
          writer.writeLine(
            `const ${varName} = { body, url: request.url };`
          );
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        } else {
          writer.writeLine(
            `const ${varName} = { url: request.url };`
          );
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        }
        break;
      }
      case TriggerType.CRON_JOB: {
        writer.writeLine(
          `const ${varName} = { triggeredAt: new Date().toISOString() };`
        );
        writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        break;
      }
      case TriggerType.MANUAL: {
        const params = trigger.params as ManualTriggerParams;
        if (params.args.length > 0) {
          const argsObj = params.args.map((a) => a.name).join(", ");
          writer.writeLine(`const ${varName} = { ${argsObj} };`);
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        }
        break;
      }
    }
  }

  // ── Private ──

  private generateFetchHandler(
    sourceFile: SourceFile,
    trigger: FlowNode,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    // Cloudflare Workers uses export default { fetch() {} } pattern
    // For consistency with other platforms, we generate a named export function
    const params = trigger.params as HttpWebhookParams;

    sourceFile.addStatements(`// Cloudflare Workers handler`);

    const funcDecl = sourceFile.addFunction({
      name: "handleRequest",
      isAsync: true,
      isExported: true,
      parameters: [
        { name: "request", type: "Request" },
        { name: "env", type: "Env" },
        { name: "ctx", type: "ExecutionContext" },
      ],
    });

    funcDecl.addStatements((writer) => {
      writer.write("try ").block(() => {
        bodyGenerator(writer);
      });
      writer.write(" catch (error) ").block(() => {
        this.generateErrorResponse(writer);
      });
    });

    // Export default handler
    sourceFile.addStatements(`
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};`);
  }

  private generateScheduledHandler(
    sourceFile: SourceFile,
    trigger: FlowNode,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    const params = trigger.params as CronJobParams;

    sourceFile.addStatements(`// @schedule ${params.schedule}`);

    const funcDecl = sourceFile.addFunction({
      name: params.functionName,
      isAsync: true,
      isExported: true,
    });

    funcDecl.addStatements((writer) => {
      bodyGenerator(writer);
    });
  }

  private generateManualFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    const params = trigger.params as ManualTriggerParams;

    const funcDecl = sourceFile.addFunction({
      name: params.functionName,
      isAsync: true,
      isExported: true,
      parameters: params.args.map((arg) => ({
        name: arg.name,
        type: arg.type,
      })),
    });

    funcDecl.addStatements((writer) => {
      bodyGenerator(writer);
    });
  }
}
