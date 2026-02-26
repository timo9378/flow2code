/**
 * Flow2Code API Handlers（純函式，不依賴 Next.js）
 *
 * 每個 handler 接收 parsed body，回傳 { status, body } 物件。
 * 供 standalone server 和 Next.js API route 共用。
 */

import { compile } from "../lib/compiler/compiler";
import { validateFlowIR } from "../lib/ir/validator";
import { convertOpenAPIToFlowIR } from "../lib/openapi/converter";
import { FLOW_IR_SYSTEM_PROMPT } from "../lib/ai/prompt";
import type { FlowIR } from "../lib/ir/types";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

// ── POST /api/compile ──

export function handleCompile(ir: FlowIR): ApiResponse {
  try {
    const result = compile(ir);
    if (result.success) {
      return {
        status: 200,
        body: {
          success: true,
          code: result.code,
          filePath: result.filePath,
          dependencies: result.dependencies,
          sourceMap: result.sourceMap,
        },
      };
    } else {
      return {
        status: 400,
        body: { success: false, error: result.errors?.join("\n") },
      };
    }
  } catch (err) {
    return {
      status: 500,
      body: {
        success: false,
        error: `伺服器錯誤: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

// ── POST /api/generate ──

export async function handleGenerate(body: { prompt?: string }): Promise<ApiResponse> {
  try {
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return { status: 400, body: { success: false, error: "請提供描述文字 (prompt)" } };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { status: 500, body: { success: false, error: "未設定 OPENAI_API_KEY 環境變數" } };
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
      return { status: 502, body: { success: false, error: `LLM API 錯誤 (${response.status}): ${errText}` } };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { status: 502, body: { success: false, error: "LLM 回傳空內容" } };
    }

    let ir: FlowIR;
    try {
      ir = JSON.parse(content);
    } catch {
      return { status: 422, body: { success: false, error: "LLM 回傳的 JSON 無法解析", raw: content } };
    }

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      return {
        status: 422,
        body: { success: false, error: "LLM 生成的 IR 驗證失敗", validationErrors: validation.errors, raw: ir as any },
      };
    }

    return { status: 200, body: { success: true, ir: ir as any } };
  } catch (err) {
    return {
      status: 500,
      body: { success: false, error: `伺服器錯誤: ${err instanceof Error ? err.message : String(err)}` },
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

    return {
      status: 200,
      body: {
        success: result.success,
        flows: filteredFlows as any,
        summary: result.summary as any,
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
