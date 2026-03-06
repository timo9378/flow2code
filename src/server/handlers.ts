/**
 * Flow2Code API Handlers (pure functions, no Next.js dependency)
 *
 * Each handler receives a parsed body and returns a { status, body } object.
 * Shared by standalone server and Next.js API routes.
 */

import { compile } from "../lib/compiler/compiler";
import { decompile } from "../lib/compiler/decompiler";
import { validateFlowIR } from "../lib/ir/validator";
import { validateIRSecurity, formatSecurityReport } from "../lib/ir/security";
import { convertOpenAPIToFlowIR } from "../lib/openapi/converter";
import { FLOW_IR_SYSTEM_PROMPT } from "../lib/ai/prompt";
import type { FlowIR } from "../lib/ir/types";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

// ── POST /api/compile ──

export interface CompileRequest {
  ir?: FlowIR;
  /** Whether to write files to the user's project (default: true) */
  write?: boolean;
}

/**
 * @param body - { ir: FlowIR, write?: boolean }
 * @param projectRoot - User's project root directory (process.cwd())
 */
export async function handleCompile(body: CompileRequest, projectRoot: string): Promise<ApiResponse> {
  try {
    const ir = body.ir;
    const shouldWrite = body.write !== false; // default: write

    if (!ir) {
      return { status: 400, body: { success: false, error: "Missing 'ir' in request body" } };
    }

    const result = compile(ir);
    if (!result.success) {
      return {
        status: 400,
        body: { success: false, error: result.errors?.join("\n") },
      };
    }

    // Prettier post-processing
    let finalCode = result.code;
    if (finalCode) {
      try {
        const { formatWithPrettier } = await import("../lib/compiler/compiler.js");
        finalCode = await formatWithPrettier(finalCode);
      } catch {
        // Prettier unavailable — use ts-morph formatted output
      }
    }

    let writtenPath: string | null = null;

    // Write file to user's project
    if (shouldWrite && result.filePath && finalCode) {
      const fullPath = resolve(join(projectRoot, result.filePath));

      // Security: prevent path traversal outside project root (append separator to prevent prefix attacks)
      const resolvedRoot = resolve(projectRoot);
      const sep = resolvedRoot.endsWith('/') || resolvedRoot.endsWith('\\') ? '' : (process.platform === 'win32' ? '\\' : '/');
      if (!fullPath.startsWith(resolvedRoot + sep)) {
        return {
          status: 400,
          body: { success: false, error: "Output path escapes project root" },
        };
      }

      const dir = dirname(fullPath);

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(fullPath, finalCode, "utf-8");
      writtenPath = fullPath;

      // Write Source Map
      if (result.sourceMap) {
        const mapPath = fullPath.replace(/\.ts$/, ".flow.map.json");
        writeFileSync(mapPath, JSON.stringify(result.sourceMap, null, 2), "utf-8");
      }

      // Check for missing packages
      if (result.dependencies && result.dependencies.all.length > 0) {
        const pkgPath = join(projectRoot, "package.json");
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const installed = new Set([
              ...Object.keys(pkg.dependencies ?? {}),
              ...Object.keys(pkg.devDependencies ?? {}),
            ]);
            result.dependencies.missing = result.dependencies.all.filter(
              (d) => !installed.has(d)
            );
          } catch {
            // ignore parse error
          }
        }
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        code: finalCode,
        filePath: result.filePath,
        writtenTo: writtenPath,
        dependencies: result.dependencies,
        sourceMap: result.sourceMap,
      },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        success: false,
        error: `Server error: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

// ── POST /api/generate ──

export async function handleGenerate(body: { prompt?: string }): Promise<ApiResponse> {
  try {
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return { status: 400, body: { success: false, error: "Missing required 'prompt' string" } };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { status: 500, body: { success: false, error: "OPENAI_API_KEY environment variable is not set" } };
    }

    const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: FLOW_IR_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { status: 502, body: { success: false, error: `LLM API error (${response.status}): ${errText}` } };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { status: 502, body: { success: false, error: "LLM returned empty content" } };
    }

    // Extract JSON from markdown code blocks (LLM may wrap JSON in ```json ... ```)
    let jsonStr = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];

    let ir: FlowIR;
    try {
      ir = JSON.parse(jsonStr);
    } catch {
      return { status: 422, body: { success: false, error: "Failed to parse LLM JSON response", raw: content } };
    }

    // Auto-Heal IR: Connect orphaned nodes to trigger
    const triggerNode = ir.nodes.find(n => n.category === "trigger");
    if (triggerNode) {
      const triggerOutputPortId = triggerNode.outputs?.[0]?.id || "output";
      const connectedTargetNodeIds = new Set(ir.edges.map(e => e.targetNodeId));
      const existingEdgeIds = new Set(ir.edges.map(e => e.id));
      let healedCount = 0;

      ir.nodes.forEach(node => {
        if (node.id !== triggerNode.id && !connectedTargetNodeIds.has(node.id) && node.inputs && node.inputs.length > 0) {
          let edgeId: string;
          do { edgeId = `healed_e_${crypto.randomUUID().slice(0, 8)}`; } while (existingEdgeIds.has(edgeId));
          existingEdgeIds.add(edgeId);
          ir.edges.push({
            id: edgeId,
            sourceNodeId: triggerNode.id,
            sourcePortId: triggerNode.nodeType === 'http_webhook' ? 'request' : triggerOutputPortId,
            targetNodeId: node.id,
            targetPortId: node.inputs[0].id
          });
          healedCount++;
        }
      });

      if (healedCount > 0) {
        console.warn(`[AutoHeal] Connected ${healedCount} orphaned nodes to trigger.`);
      }
    }

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      return {
        status: 422,
        body: { success: false, error: "LLM-generated IR failed validation", validationErrors: validation.errors, raw: ir as unknown },
      };
    }

    // Security check for AI-generated IR
    const security = validateIRSecurity(ir);
    const securityReport = security.findings.length > 0 ? formatSecurityReport(security) : undefined;

    return { status: 200, body: { success: true, ir: ir as unknown, security: { safe: security.safe, findings: security.findings as unknown, report: securityReport } } };
  } catch (err) {
    return {
      status: 500,
      body: { success: false, error: `Server error: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

// ── POST /api/import-openapi ──

export function handleImportOpenAPI(body: { spec?: unknown; filter?: { tags?: string[]; paths?: string[] } }): ApiResponse {
  try {
    if (!body.spec) {
      return { status: 400, body: { error: "Missing 'spec' field in request body" } };
    }

    const result = convertOpenAPIToFlowIR(body.spec as string | object);

    let filteredFlows = result.flows;
    if (body.filter?.paths && Array.isArray(body.filter.paths)) {
      const paths = body.filter.paths;
      filteredFlows = filteredFlows.filter((flow) =>
        paths.some((p) => flow.meta.name.includes(p))
      );
    }
    if (body.filter?.tags && Array.isArray(body.filter.tags)) {
      const tags = body.filter.tags.map((t) => t.toLowerCase());
      filteredFlows = filteredFlows.filter((flow) => {
        const flowTags = ((flow.meta as Record<string, unknown>).tags as string[] | undefined) ?? [];
        return flowTags.some((t) => tags.includes(t.toLowerCase()));
      });
    }

    return {
      status: 200,
      body: {
        success: result.success,
        flows: filteredFlows as unknown,
        summary: result.summary as unknown,
        errors: result.errors,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: error instanceof Error ? error.message : "Internal Server Error" },
    };
  }
}

// ── POST /api/decompile ──

export interface DecompileRequest {
  code?: string;
  fileName?: string;
  functionName?: string;
}

/**
 * Server-side decompile handler.
 * ts-morph requires Node.js (node:fs), so decompile MUST run server-side.
 */
export function handleDecompile(body: DecompileRequest): ApiResponse {
  try {
    const { code, fileName, functionName } = body;

    if (!code || typeof code !== "string") {
      return { status: 400, body: { success: false, error: "Missing 'code' string in request body" } };
    }

    if (code.trim().length === 0) {
      return { status: 400, body: { success: false, error: "Code is empty" } };
    }

    const result = decompile(code, {
      fileName: fileName ?? "input.ts",
      functionName,
      audit: true,
    });

    if (!result.success) {
      return {
        status: 422,
        body: {
          success: false,
          errors: result.errors ?? ["Decompile failed"],
          confidence: result.confidence,
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        ir: result.ir as unknown,
        confidence: result.confidence,
        errors: result.errors ?? [],
        audit: (result.audit ?? []) as unknown,
      },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        success: false,
        error: `Decompile error: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}
