"use client";

/**
 * 工具列元件
 * 
 * 提供匯出 IR JSON、AI 生成、編譯、重置、API 測試沙盒、OpenAPI 匯入等操作。
 */

import { useState, useRef } from "react";
import { useFlowStore } from "@/store/flow-store";
import { validateFlowIR } from "@/lib/ir/validator";
import { topologicalSort, formatExecutionPlan } from "@/lib/ir/topological-sort";
import { EXAMPLE_PROMPTS } from "@/lib/ai/prompt";
import ApiSandbox from "./ApiSandbox";

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
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ir),
      });
      const data = await res.json();
      if (data.success) {
        let msg = `✅ 編譯成功！\n📁 ${data.filePath ?? "generated.ts"}\n`;

        // 顯示依賴套件資訊
        if (data.dependencies?.missing?.length > 0) {
          msg += `\n⚠️ 缺少的套件:\n`;
          msg += data.dependencies.missing.map((d: string) => `  npm install ${d}`).join("\n");
          msg += "\n";
        }
        if (data.dependencies?.all?.length > 0) {
          msg += `\n📦 需要的套件: ${data.dependencies.all.join(", ")}\n`;
        }

        // 顯示 Source Map 資訊
        if (data.sourceMap) {
          msg += `\n🗺️ Source Map: ${Object.keys(data.sourceMap.mappings ?? {}).length} 個節點已映射\n`;
        }

        msg += `\n${data.code}`;
        setOutput(msg);

        // 自動挖出 method + routePath 供沙盒使用
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

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim() }),
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
    } catch (err) {
      setOutput(`❌ AI 請求失敗: ${err instanceof Error ? err.message : String(err)}`);
      setShowOutput(true);
    } finally {
      setAiLoading(false);
    }
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
        const res = await fetch("/api/import-openapi", {
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

  return (
    <>
      {/* 頂部工具列 */}
      <div className="h-10 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-2">
        <span className="text-white text-sm font-bold mr-4">Flow2Code</span>

        <button
          onClick={handleExportIR}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
        >
          📋 匯出 IR
        </button>

        <button
          onClick={handleValidate}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
        >
          ✅ 驗證
        </button>

        <button
          onClick={handleAnalyze}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
        >
          📊 分析執行計畫
        </button>

        <button
          onClick={handleCompile}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors cursor-pointer"
        >
          🚀 編譯
        </button>

        <button
          onClick={() => setShowAIDialog(true)}
          className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors cursor-pointer"
        >
          ✨ AI 生成
        </button>

        <div className="border-l border-gray-700 h-5 mx-1" />

        <button
          onClick={handleLoadIRFromJSON}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
        >
          📂 載入
        </button>

        <button
          onClick={handleDownloadIR}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
        >
          💾 下載
        </button>

        <button
          onClick={handleImportOpenAPI}
          className="px-3 py-1 text-xs bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors cursor-pointer"
        >
          📄 OpenAPI
        </button>

        <button
          onClick={() => setShowSandbox(true)}
          className="px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors cursor-pointer"
        >
          🧪 測試
        </button>

        <div className="flex-1" />

        <span className="text-gray-500 text-[10px]">
          Nodes: {nodes.length}
        </span>

        <button
          onClick={reset}
          className="px-3 py-1 text-xs bg-red-800 hover:bg-red-700 text-white rounded transition-colors cursor-pointer"
        >
          🗑️ 重置
        </button>
      </div>

      {/* AI 生成對話框 */}
      {showAIDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg shadow-2xl w-[600px] flex flex-col border border-gray-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-white text-sm font-semibold">✨ AI 生成流程圖</span>
              <button
                onClick={() => setShowAIDialog(false)}
                className="text-gray-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <p className="text-gray-400 text-xs">
                描述你想建立的 API 端點或工作流程，AI 會自動生成完整的流程圖。
              </p>

              <textarea
                ref={promptRef}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例如：建立一個 GET /api/users 端點，從資料庫查詢用戶列表並回傳..."
                className="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-purple-500 outline-none resize-y min-h-[100px] font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleAIGenerate();
                  }
                }}
              />

              {/* 範例提示 */}
              <div className="flex flex-col gap-1">
                <span className="text-gray-500 text-[10px] uppercase font-semibold">範例</span>
                <div className="flex flex-wrap gap-1">
                  {EXAMPLE_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setAiPrompt(p)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 bg-gray-800 hover:bg-gray-750 px-2 py-1 rounded cursor-pointer truncate max-w-[280px]"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
              <span className="text-gray-600 text-[10px]">
                ⌘+Enter 快速送出 · 需要設定 OPENAI_API_KEY
              </span>
              <button
                onClick={handleAIGenerate}
                disabled={aiLoading || !aiPrompt.trim()}
                className="px-4 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors cursor-pointer font-semibold"
              >
                {aiLoading ? "⏳ 生成中..." : "✨ 生成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 輸出面板 */}
      {showOutput && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
              <span className="text-white text-sm font-semibold">Output</span>
              <button
                onClick={() => setShowOutput(false)}
                className="text-gray-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <pre className="p-4 text-xs text-green-400 font-mono overflow-auto flex-1 whitespace-pre-wrap">
              {output}
            </pre>
          </div>
        </div>
      )}

      {/* API 測試沙盒 */}
      {showSandbox && (
        <ApiSandbox
          initialMethod={sandboxMethod}
          initialPath={sandboxPath}
          onClose={() => setShowSandbox(false)}
        />
      )}

      {/* OpenAPI 匯入選擇對話框 */}
      {showOpenAPIDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col border border-gray-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-white text-sm font-semibold">
                📄 選擇要匯入的端點 ({openAPIFlows.length} 個)
              </span>
              <button
                onClick={() => setShowOpenAPIDialog(false)}
                className="text-gray-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto flex-1 p-2">
              {openAPIFlows.map((flow: any, i: number) => (
                <button
                  key={i}
                  onClick={() => handleSelectOpenAPIFlow(flow)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 rounded transition-colors cursor-pointer flex items-center gap-3"
                >
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-700 text-white rounded min-w-[60px] text-center">
                    {flow.meta?.name?.split(" ")[0] ?? "?"}
                  </span>
                  <span className="text-white text-xs flex-1 truncate">
                    {flow.meta?.name ?? `端點 ${i + 1}`}
                  </span>
                  <span className="text-gray-500 text-[10px]">
                    {flow.nodes?.length ?? 0} nodes
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
