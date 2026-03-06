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
  handleAIRefactor: (selectedNodeIds: string[], instruction: string) => Promise<string>;
  handleCodeToFlow: (code: string) => Promise<string>;
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

  // ── AI Refactor: refactor selected nodes with a natural language instruction ──
  const handleAIRefactor = useCallback(
    async (selectedNodeIds: string[], instruction: string): Promise<string> => {
      if (selectedNodeIds.length === 0) return "❌ No nodes selected for refactoring";
      if (!instruction.trim()) return "❌ No refactoring instruction provided";

      setAiLoading(true);
      setAiStreamContent("");
      abortControllerRef.current = new AbortController();

      try {
        const activeConfig = aiSettings.getActiveConfig();
        if (!activeConfig) return "❌ AI refactoring requires a configured AI endpoint (Settings > AI)";

        const { FLOW_IR_REFACTOR_PROMPT } = await import("@/lib/ai/prompt");
        const exportIR = useFlowStore.getState().exportIR;
        const ir = exportIR();

        // Extract selected subgraph
        const selectedNodes = ir.nodes.filter((n) => selectedNodeIds.includes(n.id));
        const selectedEdges = ir.edges.filter(
          (e) => selectedNodeIds.includes(e.sourceNodeId) && selectedNodeIds.includes(e.targetNodeId)
        );

        const userMessage = `## Selected Nodes (${selectedNodes.length})\n\`\`\`json\n${JSON.stringify({ nodes: selectedNodes, edges: selectedEdges }, null, 2)}\n\`\`\`\n\n## Instruction\n${instruction}`;

        const url = activeConfig.baseUrl.replace(/\/+$/, "");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (activeConfig.apiKey) headers["Authorization"] = `Bearer ${activeConfig.apiKey}`;

        const res = await fetch(`${url}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: activeConfig.model,
            messages: [
              { role: "system", content: FLOW_IR_REFACTOR_PROMPT },
              { role: "user", content: userMessage },
            ],
            temperature: 0.2,
          }),
          signal: abortControllerRef.current?.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          return `❌ AI API error (${res.status}): ${errText}`;
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content ?? "";
        if (!content) return "❌ AI returned empty content";

        let jsonStr = content;
        const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1];

        const refactored = JSON.parse(jsonStr) as { nodes: FlowIR["nodes"]; edges: FlowIR["edges"] };

        // Merge refactored nodes back: remove old selected nodes/edges, add new ones
        const remainingNodes = ir.nodes.filter((n) => !selectedNodeIds.includes(n.id));
        const remainingEdges = ir.edges.filter(
          (e) => !selectedNodeIds.includes(e.sourceNodeId) || !selectedNodeIds.includes(e.targetNodeId)
        );

        const mergedIR: FlowIR = {
          ...ir,
          nodes: [...remainingNodes, ...refactored.nodes],
          edges: [...remainingEdges, ...refactored.edges],
        };

        loadIR(mergedIR);
        return `✅ Refactored ${selectedNodeIds.length} nodes → ${refactored.nodes.length} nodes`;
      } catch (err) {
        if ((err as Error).name === "AbortError") return "⏹️ AI refactor cancelled";
        return `❌ AI refactor failed: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        setAiLoading(false);
        setAiStreamContent("");
        abortControllerRef.current = null;
      }
    },
    [aiSettings, loadIR]
  );

  // ── Code-to-Flow: convert pasted code into FlowIR ──
  const handleCodeToFlow = useCallback(
    async (code: string): Promise<string> => {
      if (!code.trim()) return "❌ No code provided";

      setAiLoading(true);
      setAiStreamContent("");
      abortControllerRef.current = new AbortController();

      try {
        const activeConfig = aiSettings.getActiveConfig();
        if (!activeConfig) return "❌ Code-to-Flow requires a configured AI endpoint (Settings > AI)";

        const { CODE_TO_FLOW_PROMPT } = await import("@/lib/ai/prompt");

        const url = activeConfig.baseUrl.replace(/\/+$/, "");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (activeConfig.apiKey) headers["Authorization"] = `Bearer ${activeConfig.apiKey}`;

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
                    body: {
                      model: activeConfig.model,
                      messages: [
                        { role: "system", content: CODE_TO_FLOW_PROMPT },
                        { role: "user", content: `Convert the following code to FlowIR:\n\n\`\`\`\n${code}\n\`\`\`` },
                      ],
                      temperature: 0.2,
                    },
                    signal: abortControllerRef.current?.signal,
                  },
                  {
                    onToken: (token) => {
                      accumulated += token;
                      setAiStreamContent(accumulated);
                    },
                    onComplete: (full) => resolve(full),
                    onError: (err) => reject(err),
                  }
                );
              });
            },
            {
              maxRetries: 1,
              initialDelay: 1000,
              signal: abortControllerRef.current?.signal,
            }
          );
        } catch {
          const res = await fetch(`${url}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: activeConfig.model,
              messages: [
                { role: "system", content: CODE_TO_FLOW_PROMPT },
                { role: "user", content: `Convert the following code to FlowIR:\n\n\`\`\`\n${code}\n\`\`\`` },
              ],
              temperature: 0.2,
            }),
            signal: abortControllerRef.current?.signal,
          });
          if (!res.ok) {
            const errText = await res.text();
            return `❌ AI API error (${res.status}): ${errText}`;
          }
          const data = await res.json();
          content = data.choices?.[0]?.message?.content ?? "";
        }

        if (!content) return "❌ AI returned empty content";

        let jsonStr = content;
        const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1];

        const ir = JSON.parse(jsonStr) as FlowIR;

        const { validateFlowIR: validate } = await import("@/lib/ir/validator");
        const validation = validate(ir);
        if (!validation.valid) {
          return `❌ Code-to-Flow IR validation failed:\n${validation.errors.map((e: { code: string; message: string }) => `  [${e.code}] ${e.message}`).join("\n")}`;
        }

        loadIR(ir);
        const meta = ir.meta as { name?: string } | undefined;
        return `✅ Code converted to flow: "${meta?.name ?? "Untitled"}"\n📊 ${ir.nodes.length} nodes, ${ir.edges.length} edges`;
      } catch (err) {
        if ((err as Error).name === "AbortError") return "⏹️ Code-to-Flow cancelled";
        return `❌ Code-to-Flow failed: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        setAiLoading(false);
        setAiStreamContent("");
        abortControllerRef.current = null;
      }
    },
    [aiSettings, loadIR]
  );

  return {
    aiPrompt,
    setAiPrompt,
    aiLoading,
    aiStreamContent,
    tokenEstimate,
    handleAIGenerate,
    handleAIRefactor,
    handleCodeToFlow,
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
