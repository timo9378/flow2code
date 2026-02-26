/**
 * useFileOps — 檔案操作相關的業務邏輯 hook
 *
 * 從 Toolbar.tsx 提取，專注於 JSON/OpenAPI/TypeScript 檔案匯入匯出。
 */

import { useState, useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import { validateFlowIR } from "@/lib/ir/validator";
import { getApiBase } from "@/lib/api-base";
import type { FlowIR } from "@/lib/ir/types";

export interface FileOpsState {
  showOpenAPIDialog: boolean;
  setShowOpenAPIDialog: (v: boolean) => void;
  openAPIFlows: FlowIR[];
}

export interface FileOpsActions {
  handleLoadIRFromJSON: () => Promise<string | null>;
  handleImportOpenAPI: () => void;
  handleSelectOpenAPIFlow: (flow: FlowIR) => string;
  handleDecompileTS: () => void;
}

export function useFileOps(
  onOutput: (msg: string) => void
): FileOpsState & FileOpsActions {
  const loadIR = useFlowStore((s) => s.loadIR);
  const [showOpenAPIDialog, setShowOpenAPIDialog] = useState(false);
  const [openAPIFlows, setOpenAPIFlows] = useState<FlowIR[]>([]);

  const handleLoadIRFromJSON = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.flow.json";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const text = await file.text();
        try {
          const ir = JSON.parse(text) as FlowIR;
          const validation = validateFlowIR(ir);
          if (!validation.valid) {
            const msg =
              "❌ 載入的 IR 驗證失敗：\n" +
              validation.errors
                .map((err) => `  [${err.code}] ${err.message}`)
                .join("\n");
            onOutput(msg);
            resolve(msg);
            return;
          }
          loadIR(ir);
          const msg = `✅ 已載入流程圖：「${ir.meta?.name ?? "Untitled"}」`;
          onOutput(msg);
          resolve(msg);
        } catch {
          const msg = "❌ JSON 解析失敗，請確認檔案格式正確";
          onOutput(msg);
          resolve(msg);
        }
      };
      input.click();
    });
  }, [loadIR, onOutput]);

  const handleImportOpenAPI = useCallback(() => {
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
          setOpenAPIFlows(data.flows as FlowIR[]);
          setShowOpenAPIDialog(true);
        } else {
          onOutput(
            `❌ OpenAPI 匯入失敗: ${data.errors?.join(", ") ?? "沒有找到任何端點"}`
          );
        }
      } catch {
        onOutput("❌ JSON 解析失敗，請確認檔案為 OpenAPI 3.x JSON 格式");
      }
    };
    input.click();
  }, [onOutput]);

  const handleSelectOpenAPIFlow = useCallback(
    (flow: FlowIR): string => {
      loadIR(flow);
      setShowOpenAPIDialog(false);
      const msg = `✅ 已載入端點：「${flow.meta?.name ?? "Untitled"}」\n共 ${flow.nodes?.length ?? 0} 個節點`;
      onOutput(msg);
      return msg;
    },
    [loadIR, onOutput]
  );

  const handleDecompileTS = useCallback(() => {
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
          onOutput(msg);
        } else {
          onOutput(
            `❌ 反向解析失敗:\n${result.errors?.join("\n") ?? "未知錯誤"}`
          );
        }
      } catch (err) {
        onOutput(
          `❌ 解析錯誤: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };
    input.click();
  }, [loadIR, onOutput]);

  return {
    showOpenAPIDialog,
    setShowOpenAPIDialog,
    openAPIFlows,
    handleLoadIRFromJSON,
    handleImportOpenAPI,
    handleSelectOpenAPIFlow,
    handleDecompileTS,
  };
}
