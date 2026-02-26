/**
 * AI 生成 FlowIR API
 * 
 * 接收使用者的自然語言描述，透過 LLM 生成合法的 FlowIR JSON。
 * 
 * 環境變數：
 *   OPENAI_API_KEY - OpenAI 相容 API 金鑰
 *   OPENAI_BASE_URL - API 端點（預設 https://api.openai.com/v1）
 *   OPENAI_MODEL - 模型名稱（預設 gpt-4o-mini）
 */

import { NextResponse } from "next/server";
import { validateFlowIR } from "@/lib/ir/validator";
import type { FlowIR } from "@/lib/ir/types";
import { FLOW_IR_SYSTEM_PROMPT } from "@/lib/ai/prompt";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { success: false, error: "請提供描述文字 (prompt)" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "未設定 OPENAI_API_KEY 環境變數" },
        { status: 500 }
      );
    }

    const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    // 呼叫 LLM
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
      return NextResponse.json(
        { success: false, error: `LLM API 錯誤 (${response.status}): ${errText}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { success: false, error: "LLM 回傳空內容" },
        { status: 502 }
      );
    }

    // 解析 JSON
    let ir: FlowIR;
    try {
      ir = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { success: false, error: "LLM 回傳的 JSON 無法解析", raw: content },
        { status: 422 }
      );
    }

    // 驗證 IR
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: "LLM 生成的 IR 驗證失敗",
          validationErrors: validation.errors,
          raw: ir,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, ir });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `伺服器錯誤: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
