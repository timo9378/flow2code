/**
 * useCompile — Compilation, validation, and analysis business logic hook
 *
 * Extracted from Toolbar.tsx, focused on the FlowIR compilation pipeline.
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
    navigator.clipboard?.writeText(json).catch(() => {
      // Clipboard API unavailable (non-secure context) — silent fallback
    });
    return json;
  }, [exportIR]);

  const handleValidate = useCallback((): string => {
    const ir = exportIR();
    const result = validateFlowIR(ir);
    if (result.valid) {
      return "✅ IR validation passed! No errors.";
    }
    return (
      "❌ IR validation failed:\n" +
      result.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
    );
  }, [exportIR]);

  const handleAnalyze = useCallback((): string => {
    const ir = exportIR();
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      return "❌ Please fix IR errors before analyzing the execution plan.";
    }
    try {
      const plan = topologicalSort(ir);
      const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
      return formatExecutionPlan(plan, nodeMap);
    } catch (err) {
      return `❌ Analysis failed: ${err instanceof Error ? err.message : String(err)}`;
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
        let msg = `✅ Compilation successful!\n📁 ${data.filePath ?? "generated.ts"}\n`;
        if (data.writtenTo) {
          msg += `💾 Written to: ${data.writtenTo}\n`;
        }
        if (data.dependencies?.missing?.length > 0) {
          msg += `\n⚠️ Missing packages:\n`;
          msg += data.dependencies.missing
            .map((d: string) => `  npm install ${d}`)
            .join("\n");
          msg += "\n";
        }
        if (data.dependencies?.all?.length > 0) {
          msg += `\n📦 Required packages: ${data.dependencies.all.join(", ")}\n`;
        }
        if (data.sourceMap) {
          msg += `\n🗺️ Source Map: ${Object.keys(data.sourceMap.mappings ?? {}).length} nodes mapped\n`;
        }
        msg += `\n${data.code}`;
        return msg;
      }
      return `❌ Compilation failed: ${data.error}`;
    } catch (err) {
      return `❌ Compilation request failed: ${err instanceof Error ? err.message : String(err)}`;
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
    // Defer revocation — some browsers schedule download asynchronously after click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [exportIR]);

  return {
    handleCompile,
    handleValidate,
    handleAnalyze,
    handleExportIR,
    handleDownloadIR,
  };
}
