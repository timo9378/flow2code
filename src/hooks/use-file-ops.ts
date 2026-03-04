/**
 * useFileOps — File operations business logic hook
 *
 * Extracted from Toolbar.tsx, focused on JSON/OpenAPI/TypeScript file import/export.
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
              "❌ Loaded IR validation failed:\n" +
              validation.errors
                .map((err) => `  [${err.code}] ${err.message}`)
                .join("\n");
            onOutput(msg);
            resolve(msg);
            return;
          }
          loadIR(ir);
          const msg = `✅ Flow diagram loaded: "${ir.meta?.name ?? "Untitled"}"`;
          onOutput(msg);
          resolve(msg);
        } catch {
          const msg = "❌ JSON parse failed. Please verify the file format.";
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
            `❌ OpenAPI import failed: ${data.errors?.join(", ") ?? "No endpoints found"}`
          );
        }
      } catch {
        onOutput("❌ JSON parse failed. Please verify the file is in OpenAPI 3.x JSON format.");
      }
    };
    input.click();
  }, [onOutput]);

  const handleSelectOpenAPIFlow = useCallback(
    (flow: FlowIR): string => {
      loadIR(flow);
      setShowOpenAPIDialog(false);
      const msg = `✅ Endpoint loaded: "${flow.meta?.name ?? "Untitled"}"\nTotal ${flow.nodes?.length ?? 0} nodes`;
      onOutput(msg);
      return msg;
    },
    [loadIR, onOutput]
  );

  const handleDecompileTS = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ts,.tsx,.js,.jsx,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();

      if (text.trim().length === 0) {
        onOutput("❌ File is empty.");
        return;
      }

      try {
        // Decompile runs server-side (ts-morph requires Node.js)
        const { getApiBase } = await import("@/lib/api-base");
        const res = await fetch(`${getApiBase()}/api/decompile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: text,
            fileName: file.name.endsWith(".txt") ? file.name.replace(/\.txt$/, ".ts") : file.name,
          }),
        });
        const data = await res.json();

        if (data.success && data.ir) {
          loadIR(data.ir as FlowIR);
          const confidencePercent = Math.round((data.confidence ?? 0) * 100);
          let msg = `✅ TypeScript → IR decompilation successful\n`;
          msg += `📊 Confidence score: ${confidencePercent}%\n`;
          msg += `📁 ${file.name}\n`;
          msg += `\nTotal ${data.ir.nodes?.length ?? 0} nodes, ${data.ir.edges?.length ?? 0} edges`;
          if (data.errors?.length) {
            msg += `\n\n⚠️ Warnings:\n${data.errors.join("\n")}`;
          }
          if (confidencePercent < 50) {
            msg += `\n\n💡 Low confidence score — manual review of node configuration recommended`;
          }
          onOutput(msg);
        } else {
          onOutput(
            `❌ Decompilation failed:\n${data.errors?.join("\n") ?? data.error ?? "Unknown error"}`
          );
        }
      } catch (err) {
        onOutput(
          `❌ Decompile error: ${err instanceof Error ? err.message : String(err)}\n\nMake sure the dev server is running (npx flow2code dev or pnpm dev).`
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
