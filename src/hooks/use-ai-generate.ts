/**
 * useAIGenerate — AI flow chart generation business logic hook
 *
 * Extracted from Toolbar.tsx, focused on AI streaming, retry, and token management.
 */

import { useState, useRef, useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import { useAISettingsStore } from "@/store/ai-settings-store";
import {
  streamChatCompletion,
  withRetry,
  estimateTokenCount,
  checkTokenBudget,
} from "@/lib/ai/stream";
import type { FlowIR } from "@/lib/ir/types";

export interface AIGenerateState {
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
  aiLoading: boolean;
  aiStreamContent: string;
  tokenEstimate: number;
}

export interface AIGenerateActions {
  handleAIGenerate: () => Promise<string>;
  handleCancelAI: () => void;
  updateTokenEstimate: (prompt: string) => void;
}

export function useAIGenerate(): AIGenerateState & AIGenerateActions {
  const loadIR = useFlowStore((s) => s.loadIR);
  const aiSettings = useAISettingsStore();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStreamContent, setAiStreamContent] = useState("");
  const [tokenEstimate, setTokenEstimate] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const updateTokenEstimate = useCallback((prompt: string) => {
    setTokenEstimate(estimateTokenCount(prompt));
  }, []);

  const handleCancelAI = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleAIGenerate = useCallback(async (): Promise<string> => {
    if (!aiPrompt.trim()) return "";
    setAiLoading(true);
    setAiStreamContent("");
    abortControllerRef.current = new AbortController();

    try {
      const activeConfig = aiSettings.getActiveConfig();

      if (activeConfig) {
        return await generateWithDirectEndpoint(
          activeConfig,
          aiPrompt.trim(),
          abortControllerRef,
          setAiStreamContent,
          loadIR
        );
      } else {
        return await generateWithBackend(
          aiPrompt.trim(),
          abortControllerRef,
          loadIR
        );
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return "⏹️ AI generation cancelled";
      }
      return `❌ AI request failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      setAiLoading(false);
      setAiStreamContent("");
      abortControllerRef.current = null;
    }
  }, [aiPrompt, aiSettings, loadIR]);

  return {
    aiPrompt,
    setAiPrompt,
    aiLoading,
    aiStreamContent,
    tokenEstimate,
    handleAIGenerate,
    handleCancelAI,
    updateTokenEstimate,
  };
}

// ── Internal helpers ──

interface ActiveConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  supportsJsonMode?: boolean;
}

async function generateWithDirectEndpoint(
  config: ActiveConfig,
  prompt: string,
  abortRef: React.RefObject<AbortController | null>,
  setStreamContent: (v: string) => void,
  loadIR: (ir: FlowIR) => void
): Promise<string> {
  const { FLOW_IR_SYSTEM_PROMPT: systemPrompt } = await import("@/lib/ai/prompt");

  const budget = checkTokenBudget(systemPrompt, prompt);
  if (!budget.withinBudget) {
    return `⚠️ Prompt may be too long (estimated ~${budget.estimated} tokens, recommended ≤${budget.limit})\nPlease simplify your description and retry.`;
  }

  const url = config.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  };
  if (config.supportsJsonMode) {
    body.response_format = { type: "json_object" };
  }

  // SSE streaming with retry
  let content: string;
  try {
    content = await withRetry(
      async () => {
        return new Promise<string>((resolve, reject) => {
          let accumulated = "";
          streamChatCompletion(
            {
              url: `${url}/chat/completions`,
              headers,
              body,
              signal: abortRef.current?.signal,
            },
            {
              onToken: (token) => {
                accumulated += token;
                setStreamContent(accumulated);
              },
              onComplete: (full) => resolve(full),
              onError: (err) => reject(err),
            }
          );
        });
      },
      {
        maxRetries: 2,
        initialDelay: 1500,
        signal: abortRef.current?.signal,
        onRetry: (attempt, err) => {
          setStreamContent(`⏳ Retrying (${attempt}/2): ${err.message}\n`);
        },
      }
    );
  } catch {
    // Fallback to non-streaming
    const llmRes = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: abortRef.current?.signal,
    });
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return `❌ AI API error (${llmRes.status}): ${errText}`;
    }
    const llmData = await llmRes.json();
    content = llmData.choices?.[0]?.message?.content ?? "";
  }

  if (!content) return "❌ AI returned empty content";

  // Extract JSON
  let jsonStr = content;
  const codeBlockMatch = content.match(
    /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
  );
  if (codeBlockMatch) jsonStr = codeBlockMatch[1];

  let ir: FlowIR;
  try {
    ir = JSON.parse(jsonStr) as FlowIR;
  } catch {
    return `❌ JSON parsing failed:\n${content}`;
  }

  // --- Auto Heal IR: Connect orphaned nodes to trigger ---
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

  const { validateFlowIR: validate } = await import("@/lib/ir/validator");
  const validation = validate(ir);
  if (!validation.valid) {
    return `❌ IR validation failed:\n${validation.errors.map((e: { code: string; message: string }) => `  [${e.code}] ${e.message}`).join("\n")}\n\n${JSON.stringify(ir, null, 2)}`;
  }


  loadIR(ir);

  // AI Code Review
  const nodes = (ir.nodes as Array<{ category?: string; nodeType?: string }>) ?? [];
  const edges = (ir.edges as unknown[]) ?? [];
  const reviewNotes: string[] = [];
  if (!nodes.some((n) => n.category === "trigger")) reviewNotes.push("⚠️ Missing trigger node");
  if (!nodes.some((n) => n.nodeType === "return_response")) reviewNotes.push("⚠️ Missing Return Response node");
  if (nodes.length > 15) reviewNotes.push("💡 Too many nodes, consider splitting into sub-flows");
  if (edges.length === 0 && nodes.length > 1) reviewNotes.push("⚠️ No connections between nodes");

  const review =
    reviewNotes.length > 0
      ? `\n\n📋 Auto review:\n${reviewNotes.join("\n")}`
      : "\n\n✅ Auto review passed";

  const meta = ir.meta as { name?: string } | undefined;
  return `✅ AI generated flow chart: "${meta?.name ?? "Untitled"}"\n📡 ${config.name} (${config.model})\n📊 Token estimate: ~${budget.estimated}\n\n${nodes.length} nodes, ${edges.length} edges${review}`;
}

async function generateWithBackend(
  prompt: string,
  abortRef: React.RefObject<AbortController | null>,
  loadIR: (ir: FlowIR) => void
): Promise<string> {
  const { getApiBase } = await import("@/lib/api-base");
  const res = await fetch(`${getApiBase()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: abortRef.current?.signal,
  });
  const data = await res.json();
  if (data.success && data.ir) {
    loadIR(data.ir);
    return `✅ AI generated flow chart: "${data.ir.meta?.name ?? "Untitled"}"\n\n${data.ir.nodes?.length ?? 0} nodes, ${data.ir.edges?.length ?? 0} edges`;
  }
  return `❌ AI generation failed:\n${data.error ?? "Unknown error"}\n\n${data.validationErrors ? JSON.stringify(data.validationErrors, null, 2) : ""}`;
}
