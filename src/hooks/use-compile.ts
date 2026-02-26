/**
 * useCompile — 編譯、驗證、分析相關的業務邏輯 hook
 *
 * 從 Toolbar.tsx 提取，專注於 FlowIR 的編譯流程。
 */

import { useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import { validateFlowIR } from "@/lib/ir/validator";
import { topologicalSort, formatExecutionPlan } from "@/lib/ir/topological-sort";
import { getApiBase } from "@/lib/api-base";

export interface CompileHookResult {
  handleCompile: () => Promise<string>;
  handleValidate: () => string;
  handleAnalyze: () => string;
  handleExportIR: () => string;
  handleDownloadIR: () => void;
}

export function useCompile(): CompileHookResult {
  const exportIR = useFlowStore((s) => s.exportIR);

  const handleExportIR = useCallback((): string => {
    const ir = exportIR();
    const json = JSON.stringify(ir, null, 2);
    navigator.clipboard?.writeText(json);
    return json;
  }, [exportIR]);

  const handleValidate = useCallback((): string => {
    const ir = exportIR();
    const result = validateFlowIR(ir);
    if (result.valid) {
      return "✅ IR 驗證通過！沒有錯誤。";
    }
    return (
      "❌ IR 驗證失敗：\n" +
      result.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
    );
  }, [exportIR]);

  const handleAnalyze = useCallback((): string => {
    const ir = exportIR();
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      return "❌ 請先修正 IR 錯誤後再分析執行計畫。";
    }
    try {
      const plan = topologicalSort(ir);
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
      return formatExecutionPlan(plan, nodeMap);
    } catch (err) {
      return `❌ 分析失敗: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [exportIR]);

  const handleCompile = useCallback(async (): Promise<string> => {
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
          msg += data.dependencies.missing
            .map((d: string) => `  npm install ${d}`)
            .join("\n");
          msg += "\n";
        }
        if (data.dependencies?.all?.length > 0) {
          msg += `\n📦 需要的套件: ${data.dependencies.all.join(", ")}\n`;
        }
        if (data.sourceMap) {
          msg += `\n🗺️ Source Map: ${Object.keys(data.sourceMap.mappings ?? {}).length} 個節點已映射\n`;
        }
        msg += `\n${data.code}`;
        return msg;
      }
      return `❌ 編譯失敗: ${data.error}`;
    } catch (err) {
      return `❌ 編譯請求失敗: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [exportIR]);

  const handleDownloadIR = useCallback(() => {
    const ir = exportIR();
    const json = JSON.stringify(ir, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ir.meta.name.replace(/\s+/g, "-").toLowerCase() || "flow"}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportIR]);

  return {
    handleCompile,
    handleValidate,
    handleAnalyze,
    handleExportIR,
    handleDownloadIR,
  };
}
