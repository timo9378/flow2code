"use client";

/**
 * 工具列元件 — Koimsurai 風格暗色主題
 *
 * 頂部工具列 + 浮動視窗（AI、輸出、OpenAPI 選擇器）
 */

import { useState, useRef, useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import { useAISettingsStore } from "@/store/ai-settings-store";
import { validateFlowIR } from "@/lib/ir/validator";
import { topologicalSort, formatExecutionPlan } from "@/lib/ir/topological-sort";
import { EXAMPLE_PROMPTS } from "@/lib/ai/prompt";
import { getApiBase } from "@/lib/api-base";
import { streamChatCompletion, withRetry, estimateTokenCount, checkTokenBudget } from "@/lib/ai/stream";
import ApiSandbox from "./ApiSandbox";
import AISettingsDialog from "./AISettingsDialog";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Toolbar() {
  const exportIR = useFlowStore((s) => s.exportIR);
  const loadIR = useFlowStore((s) => s.loadIR);
  const reset = useFlowStore((s) => s.reset);
  const nodes = useFlowStore((s) => s.nodes);
  const [output, setOutput] = useState<string>("");
  const [showOutput, setShowOutput] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [showSandbox, setShowSandbox] = useState(false);
  const [sandboxMethod, setSandboxMethod] = useState("GET");
  const [sandboxPath, setSandboxPath] = useState("/api/hello");
  const [showOpenAPIDialog, setShowOpenAPIDialog] = useState(false);
  const [openAPIFlows, setOpenAPIFlows] = useState<any[]>([]);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiStreamContent, setAiStreamContent] = useState("");
  const [tokenEstimate, setTokenEstimate] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const aiSettings = useAISettingsStore();

  // Token 估算
  const updateTokenEstimate = useCallback((prompt: string) => {
    setTokenEstimate(estimateTokenCount(prompt));
  }, []);

  // ── handlers ──

  const handleExportIR = () => {
    const ir = exportIR();
    const json = JSON.stringify(ir, null, 2);
    setOutput(json);
    setShowOutput(true);
    navigator.clipboard?.writeText(json);
  };

  const handleValidate = () => {
    const ir = exportIR();
    const result = validateFlowIR(ir);
    if (result.valid) {
      setOutput("✅ IR 驗證通過！沒有錯誤。");
    } else {
      setOutput(
        "❌ IR 驗證失敗：\n" +
          result.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
      );
    }
    setShowOutput(true);
  };

  const handleAnalyze = () => {
    const ir = exportIR();
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      setOutput("❌ 請先修正 IR 錯誤後再分析執行計畫。");
      setShowOutput(true);
      return;
    }
    try {
      const plan = topologicalSort(ir);
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
      setOutput(formatExecutionPlan(plan, nodeMap));
    } catch (err) {
      setOutput(`❌ 分析失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
    setShowOutput(true);
  };

  const handleCompile = async () => {
    const ir = exportIR();
    try {
      const res = await fetch(`${getApiBase()}/api/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ir, write: true }),
      });
      const data = await res.json();
      if (data.success) {
        let msg = `✅ 編譯成功！\n📁 ${data.filePath ?? "generated.ts"}\n`;
        if (data.writtenTo) {
          msg += `💾 已寫入: ${data.writtenTo}\n`;
        }
        if (data.dependencies?.missing?.length > 0) {
          msg += `\n⚠️ 缺少的套件:\n`;
          msg += data.dependencies.missing.map((d: string) => `  npm install ${d}`).join("\n");
          msg += "\n";
        }
        if (data.dependencies?.all?.length > 0) {
          msg += `\n📦 需要的套件: ${data.dependencies.all.join(", ")}\n`;
        }
        if (data.sourceMap) {
          msg += `\n🗺️ Source Map: ${Object.keys(data.sourceMap.mappings ?? {}).length} 個節點已映射\n`;
        }
        msg += `\n${data.code}`;
        setOutput(msg);

        const trigger = ir.nodes.find((n: any) => n.category === "trigger");
        if (trigger?.params) {
          const p = trigger.params as any;
          if (p.method) setSandboxMethod(p.method);
          if (p.routePath) setSandboxPath(p.routePath);
        }
      } else {
        setOutput(`❌ 編譯失敗: ${data.error}`);
      }
    } catch (err) {
      setOutput(`❌ 編譯請求失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
    setShowOutput(true);
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiStreamContent("");
    abortControllerRef.current = new AbortController();
    try {
      const activeConfig = aiSettings.getActiveConfig();

      // 如果有自訂端點，直接從前端打 LLM API（避免必須設定後端環境變數）
      if (activeConfig) {
        const { FLOW_IR_SYSTEM_PROMPT: systemPrompt } = await import("@/lib/ai/prompt");

        // Token budget 檢查
        const budget = checkTokenBudget(systemPrompt, aiPrompt.trim());
        if (!budget.withinBudget) {
          setOutput(`⚠️ Prompt 可能過長（估計 ~${budget.estimated} tokens，建議 ≤${budget.limit}）\n請精簡描述後重試。`);
          setShowOutput(true);
          setAiLoading(false);
          return;
        }

        const url = activeConfig.baseUrl.replace(/\/+$/, "");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (activeConfig.apiKey) headers["Authorization"] = `Bearer ${activeConfig.apiKey}`;

        const body: Record<string, unknown> = {
          model: activeConfig.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: aiPrompt.trim() },
          ],
          temperature: 0.2,
        };
        if (activeConfig.supportsJsonMode) {
          body.response_format = { type: "json_object" };
        }

        // 嘗試使用 SSE 串流（帶自動重試）
        let content = "";
        try {
          content = await withRetry(async () => {
            return new Promise<string>((resolve, reject) => {
              let accumulated = "";
              streamChatCompletion(
                {
                  url: `${url}/chat/completions`,
                  headers,
                  body,
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
          }, {
            maxRetries: 2,
            initialDelay: 1500,
            signal: abortControllerRef.current?.signal,
            onRetry: (attempt, err) => {
              setAiStreamContent(`⏳ 重試中 (${attempt}/2)：${err.message}\n`);
            },
          });
        } catch (streamErr) {
          // 串流失敗，fallback 到非串流模式
          const llmRes = await fetch(`${url}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: abortControllerRef.current?.signal,
          });
          if (!llmRes.ok) {
            const errText = await llmRes.text();
            setOutput(`❌ AI API 錯誤 (${llmRes.status}): ${errText}`);
            setShowOutput(true);
            return;
          }
          const llmData = await llmRes.json();
          content = llmData.choices?.[0]?.message?.content ?? "";
        }

        if (!content) {
          setOutput("❌ AI 回傳空內容");
          setShowOutput(true);
          return;
        }

        // 從 content 中提取 JSON（支援 markdown code block）
        let jsonStr = content;
        const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1];

        let ir;
        try { ir = JSON.parse(jsonStr); } catch {
          setOutput(`❌ JSON 解析失敗:\n${content}`);
          setShowOutput(true);
          return;
        }
        const { validateFlowIR: validate } = await import("@/lib/ir/validator");
        const validation = validate(ir);
        if (!validation.valid) {
          setOutput(`❌ IR 驗證失敗:\n${validation.errors.map((e: { code: string; message: string }) => `  [${e.code}] ${e.message}`).join("\n")}\n\n${JSON.stringify(ir, null, 2)}`);
          setShowOutput(true);
          return;
        }

        loadIR(ir);
        setShowAIDialog(false);
        setAiPrompt("");
        setAiStreamContent("");

        // AI Code Review：自動分析生成結果
        const reviewNotes: string[] = [];
        const nodeCount = ir.nodes?.length ?? 0;
        const edgeCount = ir.edges?.length ?? 0;
        const hasTrigger = ir.nodes?.some((n: { category: string }) => n.category === "trigger");
        const hasOutput = ir.nodes?.some((n: { nodeType: string }) => n.nodeType === "return_response");
        if (!hasTrigger) reviewNotes.push("⚠️ 缺少觸發器節點");
        if (!hasOutput) reviewNotes.push("⚠️ 缺少 Return Response 節點");
        if (nodeCount > 15) reviewNotes.push("💡 節點數量較多，建議拆分為子流程");
        if (edgeCount === 0 && nodeCount > 1) reviewNotes.push("⚠️ 節點之間沒有連線");

        const review = reviewNotes.length > 0 ? `\n\n📋 自動審計:\n${reviewNotes.join("\n")}` : "\n\n✅ 自動審計通過";

        setOutput(`✅ AI 已生成流程圖：「${ir.meta?.name ?? "Untitled"}」\n📡 ${activeConfig.name} (${activeConfig.model})\n📊 Token 估計: ~${budget.estimated}\n\n共 ${nodeCount} 個節點、${edgeCount} 條連線${review}`);
        setShowOutput(true);
      } else {
        // 使用後端 /api/generate（環境變數模式）
        const res = await fetch(`${getApiBase()}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: aiPrompt.trim() }),
          signal: abortControllerRef.current?.signal,
        });
        const data = await res.json();
        if (data.success && data.ir) {
          loadIR(data.ir);
          setShowAIDialog(false);
          setAiPrompt("");
          setOutput(`✅ AI 已生成流程圖：「${data.ir.meta?.name ?? "Untitled"}」\n\n共 ${data.ir.nodes?.length ?? 0} 個節點、${data.ir.edges?.length ?? 0} 條連線`);
          setShowOutput(true);
        } else {
          setOutput(`❌ AI 生成失敗:\n${data.error ?? "未知錯誤"}\n\n${data.validationErrors ? JSON.stringify(data.validationErrors, null, 2) : ""}`);
          setShowOutput(true);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setOutput("⏹️ AI 生成已取消");
      } else {
        setOutput(`❌ AI 請求失敗: ${err instanceof Error ? err.message : String(err)}`);
      }
      setShowOutput(true);
    } finally {
      setAiLoading(false);
      setAiStreamContent("");
      abortControllerRef.current = null;
    }
  };

  const handleCancelAI = () => {
    abortControllerRef.current?.abort();
  };

  const handleLoadIRFromJSON = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.flow.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const ir = JSON.parse(text);
        const validation = validateFlowIR(ir);
        if (!validation.valid) {
          setOutput("❌ 載入的 IR 驗證失敗：\n" + validation.errors.map(e => `  [${e.code}] ${e.message}`).join("\n"));
          setShowOutput(true);
          return;
        }
        loadIR(ir);
        setOutput(`✅ 已載入流程圖：「${ir.meta?.name ?? "Untitled"}」`);
        setShowOutput(true);
      } catch {
        setOutput("❌ JSON 解析失敗，請確認檔案格式正確");
        setShowOutput(true);
      }
    };
    input.click();
  };

  const handleDownloadIR = () => {
    const ir = exportIR();
    const json = JSON.stringify(ir, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ir.meta.name.replace(/\s+/g, "-").toLowerCase() || "flow"}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportOpenAPI = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.yaml,.yml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const spec = JSON.parse(text);
        const res = await fetch(`${getApiBase()}/api/import-openapi`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec }),
        });
        const data = await res.json();
        if (data.flows && data.flows.length > 0) {
          setOpenAPIFlows(data.flows);
          setShowOpenAPIDialog(true);
        } else {
          setOutput(`❌ OpenAPI 匯入失敗: ${data.errors?.join(", ") ?? "沒有找到任何端點"}`);
          setShowOutput(true);
        }
      } catch {
        setOutput("❌ JSON 解析失敗，請確認檔案為 OpenAPI 3.x JSON 格式");
        setShowOutput(true);
      }
    };
    input.click();
  };

  const handleSelectOpenAPIFlow = (flow: any) => {
    loadIR(flow);
    setShowOpenAPIDialog(false);
    setOutput(`✅ 已載入端點：「${flow.meta?.name ?? "Untitled"}」\n共 ${flow.nodes?.length ?? 0} 個節點`);
    setShowOutput(true);
  };

  const handleDecompileTS = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ts,.js";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const { decompile } = await import("@/lib/compiler/decompiler");
        const result = decompile(text, { fileName: file.name });
        if (result.success && result.ir) {
          loadIR(result.ir);
          const confidencePercent = Math.round(result.confidence * 100);
          let msg = `✅ TypeScript → IR 反向解析成功\n`;
          msg += `📊 信心分數: ${confidencePercent}%\n`;
          msg += `📁 ${file.name}\n`;
          msg += `\n共 ${result.ir.nodes.length} 個節點、${result.ir.edges.length} 條連線`;
          if (result.errors?.length) {
            msg += `\n\n⚠️ 部分警告:\n${result.errors.join("\n")}`;
          }
          if (confidencePercent < 50) {
            msg += `\n\n💡 信心分數較低，建議手動檢查節點配置`;
          }
          setOutput(msg);
          setShowOutput(true);
        } else {
          setOutput(`❌ 反向解析失敗:\n${result.errors?.join("\n") ?? "未知錯誤"}`);
          setShowOutput(true);
        }
      } catch (err) {
        setOutput(`❌ 解析錯誤: ${err instanceof Error ? err.message : String(err)}`);
        setShowOutput(true);
      }
    };
    input.click();
  };

  return (
    <>
      {/* ── 頂部工具列 ── */}
      <header className="h-12 bg-card border-b border-border flex items-center px-4 gap-1.5 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-3">
          <img src="/favicon-32x32.png" alt="Flow2Code" className="w-6 h-6" />
          <span className="text-sm font-bold tracking-tight text-foreground">Flow2Code</span>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* 主要操作 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={handleCompile} className="text-primary hover:text-primary hover:bg-primary/10">
              🚀 編譯
            </Button>
          </TooltipTrigger>
          <TooltipContent>將流程圖編譯為 TypeScript 代碼</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={handleValidate}>
              ✅ 驗證
            </Button>
          </TooltipTrigger>
          <TooltipContent>驗證 IR 結構正確性</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={handleAnalyze}>
              📊 分析
            </Button>
          </TooltipTrigger>
          <TooltipContent>分析執行計畫（拓撲排序 + 並發偵測）</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* AI */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowAIDialog(true)} className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10">
              ✨ AI 生成
            </Button>
          </TooltipTrigger>
          <TooltipContent>用自然語言描述，AI 自動生成流程圖</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowAISettings(true)} className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 px-1.5">
              ⚙️
            </Button>
          </TooltipTrigger>
          <TooltipContent>AI API 端點設定</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* 檔案操作 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              📁 檔案
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={handleLoadIRFromJSON}>
              <span className="mr-2">📂</span> 載入 Flow JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadIR}>
              <span className="mr-2">💾</span> 下載 Flow JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportIR}>
              <span className="mr-2">📋</span> 匯出 IR 到剪貼簿
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleImportOpenAPI}>
              <span className="mr-2">📄</span> 匯入 OpenAPI Spec
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDecompileTS}>
              <span className="mr-2">🔄</span> 匯入 TypeScript（反向解析）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 測試 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowSandbox(true)} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10">
              🧪 測試
            </Button>
          </TooltipTrigger>
          <TooltipContent>開啟 API 測試沙盒</TooltipContent>
        </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Node count badge */}
        <Badge variant="secondary" className="text-[10px] font-mono">
          {nodes.length} nodes
        </Badge>

        {/* 重置 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={reset} className="text-destructive hover:text-destructive hover:bg-destructive/10">
              🗑️ 重置
            </Button>
          </TooltipTrigger>
          <TooltipContent>清除所有節點和邊</TooltipContent>
        </Tooltip>
      </header>

      {/* ── AI 生成對話框 ── */}
      <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>✨ AI 生成流程圖</DialogTitle>
            <DialogDescription>
              描述你想建立的 API 端點或工作流程，AI 會自動生成完整的流程圖。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <Textarea
              ref={promptRef}
              value={aiPrompt}
              onChange={(e) => {
                setAiPrompt(e.target.value);
                updateTokenEstimate(e.target.value);
              }}
              placeholder="例如：建立一個 GET /api/users 端點，從資料庫查詢用戶列表並回傳..."
              className="min-h-[120px] font-mono text-sm resize-y"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAIGenerate();
              }}
            />

            {/* 串流即時預覽 */}
            {aiLoading && aiStreamContent && (
              <div className="bg-secondary/50 rounded-md p-3 max-h-[120px] overflow-y-auto">
                <div className="text-[10px] text-muted-foreground mb-1 font-semibold">📡 即時串流</div>
                <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap break-words">
                  {aiStreamContent.length > 500 ? `...${aiStreamContent.slice(-500)}` : aiStreamContent}
                </pre>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">範例</span>
              <div className="flex flex-wrap gap-1">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setAiPrompt(p);
                      updateTokenEstimate(p);
                    }}
                    className="text-[10px] text-purple-400 hover:text-purple-300 bg-secondary hover:bg-secondary/80 px-2 py-1 rounded-md cursor-pointer truncate max-w-[280px] transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <span className="text-muted-foreground text-[10px]">
              ⌘+Enter 快速送出 ·{" "}
              {aiSettings.getActiveConfig()
                ? `📡 ${aiSettings.getActiveConfig()!.name}`
                : "🔑 環境變數模式"}
              {tokenEstimate > 0 && ` · ~${tokenEstimate} tokens`}
              {" · "}
              <button
                onClick={() => { setShowAISettings(true); }}
                className="text-purple-400 hover:underline cursor-pointer"
              >
                設定端點
              </button>
            </span>
            <div className="flex gap-2">
              {aiLoading && (
                <Button
                  onClick={handleCancelAI}
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/50 hover:bg-destructive/10"
                >
                  ⏹ 取消
                </Button>
              )}
              <Button
                onClick={handleAIGenerate}
                disabled={aiLoading || !aiPrompt.trim()}
                className="bg-purple-600 hover:bg-purple-500 text-white"
              >
                {aiLoading ? "⏳ 生成中..." : "✨ 生成"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 輸出面板（浮動視窗） ── */}
      <Dialog open={showOutput} onOpenChange={setShowOutput}>
        <DialogContent className="sm:max-w-[720px] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Output</DialogTitle>
            <DialogDescription>編譯、驗證或 AI 生成的輸出結果</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] w-full">
            <pre className="p-4 text-xs text-emerald-400 font-mono whitespace-pre-wrap break-words leading-relaxed max-w-full">
              {output}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── API 測試沙盒 ── */}
      {showSandbox && (
        <ApiSandbox
          initialMethod={sandboxMethod}
          initialPath={sandboxPath}
          onClose={() => setShowSandbox(false)}
        />
      )}

      {/* ── OpenAPI 匯入選擇對話框 ── */}
      <Dialog open={showOpenAPIDialog} onOpenChange={setShowOpenAPIDialog}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>📄 選擇要匯入的端點</DialogTitle>
            <DialogDescription>
              從 OpenAPI 規範中找到 {openAPIFlows.length} 個端點，選擇一個匯入：
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="flex flex-col gap-0.5 p-1">
              {openAPIFlows.map((flow: any, i: number) => (
                <button
                  key={i}
                  onClick={() => handleSelectOpenAPIFlow(flow)}
                  className="w-full text-left px-3 py-2.5 hover:bg-accent rounded-md transition-colors cursor-pointer flex items-center gap-3 group"
                >
                  <Badge variant="outline" className="min-w-[60px] justify-center text-[10px] font-bold">
                    {flow.meta?.name?.split(" ")[0] ?? "?"}
                  </Badge>
                  <span className="text-sm text-foreground flex-1 truncate group-hover:text-primary transition-colors">
                    {flow.meta?.name ?? `端點 ${i + 1}`}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {flow.nodes?.length ?? 0} nodes
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── AI 設定對話框 ── */}
      <AISettingsDialog open={showAISettings} onOpenChange={setShowAISettings} />
    </>
  );
}
