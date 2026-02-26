/**
 * useAIGenerate — AI 生成流程圖的業務邏輯 hook
 *
 * 從 Toolbar.tsx 提取，專注於 AI streaming、retry、token 管理。
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
        return "⏹️ AI 生成已取消";
      }
      return `❌ AI 請求失敗: ${err instanceof Error ? err.message : String(err)}`;
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
  loadIR: (ir: Record<string, unknown>) => void
): Promise<string> {
  const { FLOW_IR_SYSTEM_PROMPT: systemPrompt } = await import("@/lib/ai/prompt");

  const budget = checkTokenBudget(systemPrompt, prompt);
  if (!budget.withinBudget) {
    return `⚠️ Prompt 可能過長（估計 ~${budget.estimated} tokens，建議 ≤${budget.limit}）\n請精簡描述後重試。`;
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
          setStreamContent(`⏳ 重試中 (${attempt}/2)：${err.message}\n`);
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
      return `❌ AI API 錯誤 (${llmRes.status}): ${errText}`;
    }
    const llmData = await llmRes.json();
    content = llmData.choices?.[0]?.message?.content ?? "";
  }

  if (!content) return "❌ AI 回傳空內容";

  // Extract JSON
  let jsonStr = content;
  const codeBlockMatch = content.match(
    /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
  );
  if (codeBlockMatch) jsonStr = codeBlockMatch[1];

  let ir: Record<string, unknown>;
  try {
    ir = JSON.parse(jsonStr);
  } catch {
    return `❌ JSON 解析失敗:\n${content}`;
  }

  const { validateFlowIR: validate } = await import("@/lib/ir/validator");
  const validation = validate(ir);
  if (!validation.valid) {
    return `❌ IR 驗證失敗:\n${validation.errors.map((e: { code: string; message: string }) => `  [${e.code}] ${e.message}`).join("\n")}\n\n${JSON.stringify(ir, null, 2)}`;
  }

  loadIR(ir);

  // AI Code Review
  const nodes = (ir.nodes as Array<{ category?: string; nodeType?: string }>) ?? [];
  const edges = (ir.edges as unknown[]) ?? [];
  const reviewNotes: string[] = [];
  if (!nodes.some((n) => n.category === "trigger")) reviewNotes.push("⚠️ 缺少觸發器節點");
  if (!nodes.some((n) => n.nodeType === "return_response")) reviewNotes.push("⚠️ 缺少 Return Response 節點");
  if (nodes.length > 15) reviewNotes.push("💡 節點數量較多，建議拆分為子流程");
  if (edges.length === 0 && nodes.length > 1) reviewNotes.push("⚠️ 節點之間沒有連線");

  const review =
    reviewNotes.length > 0
      ? `\n\n📋 自動審計:\n${reviewNotes.join("\n")}`
      : "\n\n✅ 自動審計通過";

  const meta = ir.meta as { name?: string } | undefined;
  return `✅ AI 已生成流程圖：「${meta?.name ?? "Untitled"}」\n📡 ${config.name} (${config.model})\n📊 Token 估計: ~${budget.estimated}\n\n共 ${nodes.length} 個節點、${edges.length} 條連線${review}`;
}

async function generateWithBackend(
  prompt: string,
  abortRef: React.RefObject<AbortController | null>,
  loadIR: (ir: Record<string, unknown>) => void
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
    return `✅ AI 已生成流程圖：「${data.ir.meta?.name ?? "Untitled"}」\n\n共 ${data.ir.nodes?.length ?? 0} 個節點、${data.ir.edges?.length ?? 0} 條連線`;
  }
  return `❌ AI 生成失敗:\n${data.error ?? "未知錯誤"}\n\n${data.validationErrors ? JSON.stringify(data.validationErrors, null, 2) : ""}`;
}
