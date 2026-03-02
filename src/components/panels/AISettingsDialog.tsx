"use client";

/**
 * AI API Settings Panel
 *
 * Manage AI endpoint settings:
 * - Choose between environment variables or custom endpoints
 * - Add/Edit/Delete custom endpoints
 * - Supports copilot-api, Gemini Web API, any OpenAI-compatible proxy
 */

import { useState } from "react";
import { useAISettingsStore, type AIEndpointConfig } from "@/store/ai-settings-store";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const EMPTY_CONFIG: AIEndpointConfig = {
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "gpt-4o",
  supportsJsonMode: true,
};

export default function AISettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    activeEndpointId,
    endpoints,
    setActiveEndpoint,
    addEndpoint,
    updateEndpoint,
    removeEndpoint,
  } = useAISettingsStore();

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editConfig, setEditConfig] = useState<AIEndpointConfig>(EMPTY_CONFIG);
  const [isAdding, setIsAdding] = useState(false);

  const handleStartAdd = () => {
    setEditConfig(EMPTY_CONFIG);
    setEditIndex(null);
    setIsAdding(true);
  };

  const handleStartEdit = (index: number) => {
    setEditConfig({ ...endpoints[index] });
    setEditIndex(index);
    setIsAdding(true);
  };

  const handleSave = () => {
    if (!editConfig.name.trim() || !editConfig.baseUrl.trim()) return;
    if (editIndex !== null) {
      updateEndpoint(editIndex, editConfig);
    } else {
      addEndpoint(editConfig);
    }
    setIsAdding(false);
    setEditConfig(EMPTY_CONFIG);
    setEditIndex(null);
  };

  const handleTestConnection = async (config: AIEndpointConfig) => {
    try {
      const url = config.baseUrl.replace(/\/+$/, "");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

      const res = await fetch(`${url}/models`, { headers });
      if (res.ok) {
        alert("✅ Connection successful!");
      } else {
        alert(`❌ Connection failed: HTTP ${res.status}`);
      }
    } catch (err) {
      alert(`❌ Connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>⚙️ AI API Settings</DialogTitle>
          <DialogDescription>
            Configure AI endpoints to generate flow diagrams using natural language. Supports OpenAI, copilot-api reverse proxy, Gemini Web API, or any OpenAI-compatible API.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[55vh]">
          <div className="space-y-4 p-1">
            {/* Environment Variable Option */}
            <button
              onClick={() => setActiveEndpoint("env")}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-all cursor-pointer ${
                activeEndpointId === "env"
                  ? "border-purple-500 bg-purple-500/10"
                  : "border-border hover:bg-accent"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">🔑 Environment Variable Mode</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Uses OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
                  </p>
                </div>
                {activeEndpointId === "env" && (
                  <Badge className="bg-purple-600 text-white text-[10px]">Active</Badge>
                )}
              </div>
            </button>

            <Separator />

            {/* Custom Endpoints List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                  Custom Endpoints
                </p>
                <Button variant="outline" size="sm" onClick={handleStartAdd} className="h-7 text-xs">
                  + Add Endpoint
                </Button>
              </div>

              {endpoints.map((ep, i) => (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveEndpoint(String(i))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActiveEndpoint(String(i)); }}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-all cursor-pointer ${
                    activeEndpointId === String(i)
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{ep.name}</p>
                        <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                          {ep.model}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                        {ep.baseUrl}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {activeEndpointId === String(i) && (
                        <Badge className="bg-purple-600 text-white text-[10px]">Active</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTestConnection(ep);
                        }}
                      >
                        🔌
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(i);
                        }}
                      >
                        ✏️
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-xs text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeEndpoint(i);
                        }}
                      >
                        🗑️
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {endpoints.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No custom endpoints added yet
                </p>
              )}
            </div>

            {/* Add/Edit Form */}
            {isAdding && (
              <>
                <Separator />
                <div className="space-y-3 p-3 border border-border rounded-lg bg-secondary/30">
                  <p className="text-xs font-semibold">
                    {editIndex !== null ? "✏️ Edit Endpoint" : "➕ Add Endpoint"}
                  </p>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider">Name</Label>
                      <Input
                        value={editConfig.name}
                        onChange={(e) => setEditConfig((c) => ({ ...c, name: e.target.value }))}
                        placeholder="My Copilot API"
                        className="font-mono text-xs h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider">Base URL</Label>
                      <Input
                        value={editConfig.baseUrl}
                        onChange={(e) => setEditConfig((c) => ({ ...c, baseUrl: e.target.value }))}
                        placeholder="http://localhost:4141/v1"
                        className="font-mono text-xs h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider">API Key (optional)</Label>
                      <Input
                        type="password"
                        value={editConfig.apiKey}
                        onChange={(e) => setEditConfig((c) => ({ ...c, apiKey: e.target.value }))}
                        placeholder="sk-xxxx (can be left empty for reverse proxies)"
                        className="font-mono text-xs h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider">Model</Label>
                      <Input
                        value={editConfig.model}
                        onChange={(e) => setEditConfig((c) => ({ ...c, model: e.target.value }))}
                        placeholder="gpt-4o"
                        className="font-mono text-xs h-8 mt-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="json-mode"
                        checked={editConfig.supportsJsonMode}
                        onChange={(e) =>
                          setEditConfig((c) => ({
                            ...c,
                            supportsJsonMode: e.target.checked,
                          }))
                        }
                        className="rounded border-border accent-primary"
                      />
                      <Label htmlFor="json-mode" className="text-[10px] uppercase tracking-wider cursor-pointer">
                        Supports JSON Mode (response_format)
                      </Label>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsAdding(false);
                        setEditIndex(null);
                      }}
                      className="h-7 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={!editConfig.name.trim() || !editConfig.baseUrl.trim()}
                      className="h-7 text-xs bg-purple-600 hover:bg-purple-500 text-white"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* Description */}
            <Separator />
            <div className="space-y-1.5 text-[10px] text-muted-foreground">
              <p className="font-semibold uppercase tracking-wider">Supported API Formats</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li><strong>OpenAI</strong> — api.openai.com/v1</li>
                <li><strong>copilot-api</strong> — Reverse GitHub Copilot API (localhost:4141/v1)</li>
                <li><strong>Gemini Web API</strong> — Reverse Google Gemini</li>
                <li><strong>Ollama</strong> — localhost:11434/v1</li>
                <li>Any OpenAI-compatible /chat/completions endpoint</li>
              </ul>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
