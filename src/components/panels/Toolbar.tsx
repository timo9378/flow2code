"use client";

/**
 * Toolbar component — Koimsurai-style dark theme
 *
 * Top toolbar + floating dialogs (AI, Output, OpenAPI selector)
 * Business logic extracted to hooks: useCompile, useAIGenerate, useFileOps
 */

import { useState, useRef, useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import { useAISettingsStore } from "@/store/ai-settings-store";
import { EXAMPLE_PROMPTS } from "@/lib/ai/prompt";
import { useCompile } from "@/hooks/use-compile";
import { useAIGenerate } from "@/hooks/use-ai-generate";
import { useFileOps } from "@/hooks/use-file-ops";
import ApiSandbox from "./ApiSandbox";
import AISettingsDialog from "./AISettingsDialog";
import HistoryPanel from "./HistoryPanel";

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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
  // ── Store selectors ──
  const exportIR = useFlowStore((s) => s.exportIR);
  const reset = useFlowStore((s) => s.reset);
  const nodes = useFlowStore((s) => s.nodes);

  // ── UI state ──
  const [output, setOutput] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [sandboxMethod, setSandboxMethod] = useState("GET");
  const [sandboxPath, setSandboxPath] = useState("/api/hello");
  const [showAISettings, setShowAISettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const aiSettings = useAISettingsStore();

  // ── Business-logic hooks ──
  const compile = useCompile();
  const ai = useAIGenerate();
  const fileOps = useFileOps(
    useCallback((msg: string) => {
      setOutput(msg);
      setShowOutput(true);
    }, [])
  );

  // ── Thin UI wrappers ──

  const onExportIR = () => {
    const json = compile.handleExportIR();
    setOutput(json);
    setShowOutput(true);
  };

  const onValidate = () => {
    setOutput(compile.handleValidate());
    setShowOutput(true);
  };

  const onAnalyze = () => {
    setOutput(compile.handleAnalyze());
    setShowOutput(true);
  };

  const onCompile = async () => {
    const result = await compile.handleCompile();
    setOutput(result);
    setShowOutput(true);

    // Sync sandbox parameters
    if (result.startsWith("✅")) {
      const ir = exportIR();
      const trigger = ir.nodes.find((n) => n.category === "trigger");
      if (trigger?.params) {
        const p = trigger.params as Record<string, unknown>;
        if (typeof p.method === "string") setSandboxMethod(p.method);
        if (typeof p.routePath === "string") setSandboxPath(p.routePath);
      }
    }
  };

  const onAIGenerate = async () => {
    const result = await ai.handleAIGenerate();
    if (!result) return;
    setOutput(result);
    setShowOutput(true);
    if (result.startsWith("✅")) {
      setShowAIDialog(false);
      ai.setAiPrompt("");
    }
  };

  return (
    <>
      {/* ── Top Toolbar ── */}
      <header className="h-12 bg-card border-b border-border flex items-center px-4 gap-1.5 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-3">
          <img src="/favicon-32x32.png" alt="Flow2Code" className="w-6 h-6" />
          <span className="text-sm font-bold tracking-tight text-foreground">Flow2Code</span>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Primary Actions */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onCompile} className="text-primary hover:text-primary hover:bg-primary/10">
              🚀 Compile
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compile the flow diagram to TypeScript code</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onValidate}>
              ✅ Validate
            </Button>
          </TooltipTrigger>
          <TooltipContent>Validate IR structural correctness</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onAnalyze}>
              📊 Analyze
            </Button>
          </TooltipTrigger>
          <TooltipContent>Analyze execution plan (topological sort + concurrency detection)</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* AI */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowAIDialog(true)} className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10">
              ✨ AI Generate
            </Button>
          </TooltipTrigger>
          <TooltipContent>Describe in natural language, AI auto-generates the flow diagram</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowAISettings(true)} className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 px-1.5">
              ⚙️
            </Button>
          </TooltipTrigger>
          <TooltipContent>AI API endpoint settings</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* File Operations */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              📁 File
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => fileOps.handleLoadIRFromJSON()}>
              <span className="mr-2">📂</span> Load Flow JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={compile.handleDownloadIR}>
              <span className="mr-2">💾</span> Download Flow JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportIR}>
              <span className="mr-2">📋</span> Export IR to Clipboard
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={fileOps.handleImportOpenAPI}>
              <span className="mr-2">📄</span> Import OpenAPI Spec
            </DropdownMenuItem>
            <DropdownMenuItem onClick={fileOps.handleDecompileTS}>
              <span className="mr-2">🔄</span> Import TypeScript (Decompile)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Test */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowSandbox(true)} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10">
              🧪 Test
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open API test sandbox</TooltipContent>
        </Tooltip>

        {/* History */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)}>
              📜 History
            </Button>
          </TooltipTrigger>
          <TooltipContent>View flow history and restore previous states</TooltipContent>
        </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Node count badge */}
        <Badge variant="secondary" className="text-[10px] font-mono">
          {nodes.length} nodes
        </Badge>

        {/* Reset */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={reset} className="text-destructive hover:text-destructive hover:bg-destructive/10">
              🗑️ Reset
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear all nodes and edges</TooltipContent>
        </Tooltip>
      </header>

      {/* ── AI Generate Dialog ── */}
      <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>✨ AI Generate Flow Diagram</DialogTitle>
            <DialogDescription>
              Describe the API endpoint or workflow you want to build, and AI will automatically generate the complete flow diagram.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2 overflow-y-auto min-h-0">
            <Textarea
              ref={promptRef}
              value={ai.aiPrompt}
              onChange={(e) => {
                ai.setAiPrompt(e.target.value);
                ai.updateTokenEstimate(e.target.value);
              }}
              placeholder="e.g.: Create a GET /api/users endpoint that queries the user list from the database and returns it..."
              className="min-h-[120px] font-mono text-sm resize-y"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onAIGenerate();
              }}
            />

            {/* Streaming Live Preview */}
            {ai.aiLoading && ai.aiStreamContent && (
              <div className="bg-secondary/50 rounded-md p-3 overflow-hidden">
                <div className="text-[10px] text-muted-foreground mb-1 font-semibold">📡 Live Stream</div>
                <ScrollArea className="max-h-[200px] w-full">
                  <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap break-words">{ai.aiStreamContent.length > 500 ? `...${ai.aiStreamContent.slice(-500)}` : ai.aiStreamContent}</pre>
                  <ScrollBar orientation="vertical" />
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Examples</span>
              <div className="flex flex-wrap gap-1">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      ai.setAiPrompt(p);
                      ai.updateTokenEstimate(p);
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
              ⌘+Enter to submit ·{" "}
              {aiSettings.getActiveConfig()
                ? `📡 ${aiSettings.getActiveConfig()!.name}`
                : "🔑 Environment variable mode"}
              {ai.tokenEstimate > 0 && ` · ~${ai.tokenEstimate} tokens`}
              {" · "}
              <button
                onClick={() => { setShowAISettings(true); }}
                className="text-purple-400 hover:underline cursor-pointer"
              >
                Configure endpoint
              </button>
            </span>
            <div className="flex gap-2">
              {ai.aiLoading && (
                <Button
                  onClick={ai.handleCancelAI}
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/50 hover:bg-destructive/10"
                >
                  ⏹ Cancel
                </Button>
              )}
              <Button
                onClick={onAIGenerate}
                disabled={ai.aiLoading || !ai.aiPrompt.trim()}
                className="bg-purple-600 hover:bg-purple-500 text-white"
              >
                {ai.aiLoading ? "⏳ Generating..." : "✨ Generate"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Output Panel (Floating Dialog) ── */}
      <Dialog open={showOutput} onOpenChange={setShowOutput}>
        <DialogContent className="sm:max-w-[720px] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Output</DialogTitle>
            <DialogDescription>Output from compilation, validation, or AI generation</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] w-full">
            <pre className="p-4 text-xs text-emerald-400 font-mono whitespace-pre-wrap break-words leading-relaxed">
              {output}
            </pre>
            <ScrollBar orientation="vertical" />
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── API Test Sandbox ── */}
      {showSandbox && (
        <ApiSandbox
          initialMethod={sandboxMethod}
          initialPath={sandboxPath}
          onClose={() => setShowSandbox(false)}
        />
      )}

      {/* ── OpenAPI Import Selection Dialog ── */}
      <Dialog open={fileOps.showOpenAPIDialog} onOpenChange={fileOps.setShowOpenAPIDialog}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>📄 Select Endpoint to Import</DialogTitle>
            <DialogDescription>
              Found {fileOps.openAPIFlows.length} endpoints in the OpenAPI spec. Select one to import:
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="flex flex-col gap-0.5 p-1">
              {fileOps.openAPIFlows.map((flow, i: number) => (
                <button
                  key={i}
                  onClick={() => fileOps.handleSelectOpenAPIFlow(flow)}
                  className="w-full text-left px-3 py-2.5 hover:bg-accent rounded-md transition-colors cursor-pointer flex items-center gap-3 group"
                >
                  <Badge variant="outline" className="min-w-[60px] justify-center text-[10px] font-bold">
                    {flow.meta?.name?.split(" ")[0] ?? "?"}
                  </Badge>
                  <span className="text-sm text-foreground flex-1 truncate group-hover:text-primary transition-colors">
                    {flow.meta?.name ?? `Endpoint ${i + 1}`}
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

      {/* ── AI Settings Dialog ── */}
      <AISettingsDialog open={showAISettings} onOpenChange={setShowAISettings} />

      {/* ── History Dialog ── */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="sm:max-w-[520px] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>📜 Flow History</DialogTitle>
            <DialogDescription>
              Browse and restore previous flow states. History is automatically saved on AI generation, file load, and reset.
            </DialogDescription>
          </DialogHeader>
          <HistoryPanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
