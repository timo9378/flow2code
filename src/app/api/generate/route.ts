/**
 * AI Generate FlowIR API
 * 
 * Receives a natural language description and generates valid FlowIR JSON via LLM.
 * 
 * Environment variables:
 *   OPENAI_API_KEY - OpenAI-compatible API key
 *   OPENAI_BASE_URL - API endpoint (default: https://api.openai.com/v1)
 *   OPENAI_MODEL - Model name (default: gpt-4o-mini)
 */

import { NextResponse } from "next/server";
import { validateFlowIR } from "@/lib/ir/validator";
import { validateIRSecurity, formatSecurityReport } from "@/lib/ir/security";
import type { FlowIR } from "@/lib/ir/types";
import { FLOW_IR_SYSTEM_PROMPT } from "@/lib/ai/prompt";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing required 'prompt' string" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "OPENAI_API_KEY environment variable is not set" },
        { status: 500 }
      );
    }

    const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    // Call LLM
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
        { success: false, error: `LLM API error (${response.status}): ${errText}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { success: false, error: "LLM returned empty content" },
        { status: 502 }
      );
    }

    // Parse JSON (handle potential markdown code blocks)
    let jsonStr = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];

    let ir: FlowIR;
    try {
      ir = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { success: false, error: "Failed to parse LLM JSON response", raw: content },
        { status: 422 }
      );
    }

    // Auto Heal IR: Connect orphaned nodes to trigger
    const triggerNode = ir.nodes.find(n => n.category === "trigger");
    if (triggerNode) {
      const triggerOutputPortId = triggerNode.outputs?.[0]?.id || "output";
      const connectedTargetNodeIds = new Set(ir.edges.map(e => e.targetNodeId));
      let healedCount = 0;

      ir.nodes.forEach(node => {
        // Connect nodes that have inputs but aren't targeted by any edge
        if (node.id !== triggerNode.id && !connectedTargetNodeIds.has(node.id) && node.inputs && node.inputs.length > 0) {
          ir.edges.push({
            id: `healed_e_${crypto.randomUUID().slice(0, 8)}`,
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

    // Validate IR
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: "LLM-generated IR failed validation",
          validationErrors: validation.errors,
          raw: ir,
        },
        { status: 422 }
      );
    }

    // Security check for AI-generated IR
    const security = validateIRSecurity(ir);
    const securityReport = security.findings.length > 0 ? formatSecurityReport(security) : undefined;

    return NextResponse.json({
      success: true,
      ir,
      security: {
        safe: security.safe,
        findings: security.findings,
        report: securityReport,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `Server error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
