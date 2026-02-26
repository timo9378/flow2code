/**
 * Express.js Platform Adapter
 *
 * 生成與 Express.js 相容的 route handler 代碼。
 * 證明平台解耦的可行性。
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

export class ExpressPlatform implements PlatformAdapter {
  readonly name = "express";

  generateImports(
    sourceFile: SourceFile,
    trigger: FlowNode,
    _context: PlatformContext
  ): void {
    if (trigger.nodeType === TriggerType.HTTP_WEBHOOK) {
      sourceFile.addImportDeclaration({
        namedImports: ["Request", "Response"],
        moduleSpecifier: "express",
      });
    }
  }

  generateFunction(
    sourceFile: SourceFile,
    trigger: FlowNode,
    _context: PlatformContext,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    switch (trigger.nodeType) {
      case TriggerType.HTTP_WEBHOOK:
        this.generateHttpHandler(sourceFile, trigger, bodyGenerator);
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
      for (const [key, value] of Object.entries(headers)) {
        writer.writeLine(`res.setHeader(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
      }
    }
    writer.writeLine(`return res.status(${statusCode}).json(${bodyExpr});`);
  }

  generateErrorResponse(writer: CodeBlockWriter): void {
    writer.writeLine('console.error("Workflow failed:", error);');
    writer.writeLine(
      'return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });'
    );
  }

  getOutputFilePath(trigger: FlowNode): string {
    if (trigger.nodeType === TriggerType.HTTP_WEBHOOK) {
      const params = trigger.params as HttpWebhookParams;
      const routePath = params.routePath.replace(/^\//, "").replace(/\//g, "-");
      return `src/routes/${routePath}.ts`;
    }
    if (trigger.nodeType === TriggerType.CRON_JOB) {
      const params = trigger.params as CronJobParams;
      return `src/cron/${params.functionName}.ts`;
    }
    if (trigger.nodeType === TriggerType.MANUAL) {
      const params = trigger.params as ManualTriggerParams;
      return `src/functions/${params.functionName}.ts`;
    }
    return "src/generated/flow.ts";
  }

  getImplicitDependencies(): string[] {
    return ["express", "@types/express"];
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
            "const query = req.query as Record<string, string>;"
          );
          writer.writeLine(
            `const ${varName} = { query, url: req.originalUrl };`
          );
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        } else if (
          params.parseBody &&
          ["POST", "PUT", "PATCH"].includes(params.method)
        ) {
          writer.writeLine("const body = req.body;");
          writer.writeLine(
            `const ${varName} = { body, url: req.originalUrl };`
          );
          writer.writeLine(`flowState['${trigger.id}'] = ${varName};`);
        } else {
          writer.writeLine(
            `const ${varName} = { url: req.originalUrl };`
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

  private generateHttpHandler(
    sourceFile: SourceFile,
    trigger: FlowNode,
    bodyGenerator: (writer: CodeBlockWriter) => void
  ): void {
    const params = trigger.params as HttpWebhookParams;

    const funcDecl = sourceFile.addFunction({
      name: `handle${params.method.charAt(0)}${params.method.slice(1).toLowerCase()}`,
      isAsync: true,
      isExported: true,
      parameters: [
        { name: "req", type: "Request" },
        { name: "res", type: "Response" },
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
