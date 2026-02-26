/**
 * Next.js App Router Platform Adapter
 *
 * 生成與 Next.js App Router 相容的 API Route 代碼。
 * 這是預設的平台適配器（向後相容）。
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

export class NextjsPlatform implements PlatformAdapter {
  readonly name = "nextjs";

  generateImports(
    sourceFile: SourceFile,
    trigger: FlowNode,
    _context: PlatformContext
  ): void {
    if (trigger.nodeType !== TriggerType.HTTP_WEBHOOK) return;

    const params = trigger.params as HttpWebhookParams;
    const isGetOrDelete = ["GET", "DELETE"].includes(params.method);

    sourceFile.addImportDeclaration({
      namedImports: isGetOrDelete
        ? ["NextRequest", "NextResponse"]
        : ["NextResponse"],
      moduleSpecifier: "next/server",
    });
  }

  generateFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    _context: PlatformContext,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    switch (trigger.nodeType) {
      case TriggerType.HTTP_WEBHOOK:
        this.generateHttpFunction(sourceFile, trigger, bodyGenerator);
        break;
      case TriggerType.CRON_JOB:
        this.generateCronFunction(sourceFile, trigger, bodyGenerator);
        break;
      case TriggerType.MANUAL:
        this.generateManualFunction(sourceFile, trigger, bodyGenerator);
        break;
      default:
        throw new Error(`不支援的觸發器類型: ${trigger.nodeType}`);
    }
  }

  generateResponse(
    writer: CodeBlockWriter,
    bodyExpr: string,
    statusCode: number,
    headers?: Record<string, string>
  ): void {
    if (headers && Object.keys(headers).length > 0) {
      writer.writeLine(
        `return NextResponse.json(${bodyExpr}, { status: ${statusCode}, headers: ${JSON.stringify(headers)} });`
      );
    } else {
      writer.writeLine(
        `return NextResponse.json(${bodyExpr}, { status: ${statusCode} });`
      );
    }
  }

  generateErrorResponse(writer: CodeBlockWriter): void {
    writer.writeLine('console.error("Workflow failed:", error);');
    writer.writeLine(
      'return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });'
    );
  }

  getOutputFilePath(trigger: FlowNode): string {
    if (trigger.nodeType === TriggerType.HTTP_WEBHOOK) {
      const params = trigger.params as HttpWebhookParams;
      const routePath = params.routePath.replace(/^\//, "");
      return `src/app/${routePath}/route.ts`;
    }
    if (trigger.nodeType === TriggerType.CRON_JOB) {
      const params = trigger.params as CronJobParams;
      return `src/lib/cron/${params.functionName}.ts`;
    }
    if (trigger.nodeType === TriggerType.MANUAL) {
      const params = trigger.params as ManualTriggerParams;
      return `src/lib/functions/${params.functionName}.ts`;
    }
    return "src/generated/flow.ts";
  }

  getImplicitDependencies(): string[] {
    return []; // next is a peer dependency
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
          writer.writeLine("const searchParams = req.nextUrl.searchParams;");
          writer.writeLine(
            "const query = Object.fromEntries(searchParams.entries());"
          );
          writer.writeLine(`const ${varName} = { query, url: req.url };`);
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        } else if (
          params.parseBody &&
          ["POST", "PUT", "PATCH"].includes(params.method)
        ) {
          writer.writeLine("let body: any;");
          writer.write("try ").block(() => {
            writer.writeLine("body = await req.json();");
          });
          writer.write(" catch ").block(() => {
            writer.writeLine(
              'return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });'
            );
          });
          writer.writeLine(`const ${varName} = { body, url: req.url };`);
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        } else {
          writer.writeLine(`const ${varName} = { url: req.url };`);
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

  private generateHttpFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    const params = trigger.params as HttpWebhookParams;
    const isGetOrDelete = ["GET", "DELETE"].includes(params.method);

    const funcDecl = sourceFile.addFunction({
      name: params.method,
      isAsync: true,
      isExported: true,
      parameters: [
        { name: "req", type: isGetOrDelete ? "NextRequest" : "Request" },
      ],
    });

    funcDecl.addStatements((writer) => {
      writer.write("try ").block(() => {
        // flowState 初始化（由 compiler 注入具型別版本）
        bodyGenerator(writer);
      });
      writer.write(" catch (error) ").block(() => {
        this.generateErrorResponse(writer);
      });
    });
  }

  private generateCronFunction(
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
