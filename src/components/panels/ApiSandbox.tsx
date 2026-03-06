"use client";

/**
 * API Test Sandbox Component — shadcn/ui version
 *
 * v0.2.0 enhancements:
 * - Compile & Test: auto-compile flow, sync endpoint params, then send request
 * - Request history: track past requests/responses for comparison
 * - cURL export: copy request as cURL command
 */

import { useState, useCallback } from "react";
import { useFlowStore } from "@/store/flow-store";
import { useCompile } from "@/hooks/use-compile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SandboxProps {
  initialMethod?: string;
  initialPath?: string;
  onClose: () => void;
}

interface SandboxResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

interface HistoryItem {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  response: SandboxResponse | null;
  error: string | null;
}

export default function ApiSandbox({
  initialMethod = "GET",
  initialPath = "/api/hello",
  onClose,
}: SandboxProps) {
  const [method, setMethod] = useState(initialMethod);
  const [url, setUrl] = useState(`http://localhost:3003${initialPath}`);
  const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [body, setBody] = useState("{}");
  const [response, setResponse] = useState<SandboxResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<"request" | "history">("request");

  const exportIR = useFlowStore((s) => s.exportIR);
  const compile = useCompile();

  // Compile current flow and auto-sync sandbox params
  const handleCompileAndTest = useCallback(async () => {
    const ir = exportIR();
    const trigger = ir.nodes.find((n) => n.category === "trigger");
    if (trigger?.params) {
      const p = trigger.params as Record<string, unknown>;
      if (typeof p.method === "string") setMethod(p.method);
      if (typeof p.routePath === "string") {
        setUrl(`http://localhost:3003${p.routePath}`);
      }
    }
    // Run compile
    const result = await compile.handleCompile();
    if (result.startsWith("✅")) {
      // Auto-send after successful compile
      setLoading(true);
      setError(null);
      setResponse(null);
      const start = performance.now();
      try {
        let parsedHeaders: Record<string, string> = {};
        try { parsedHeaders = JSON.parse(headers); } catch { /* use empty */ }

        const triggerMethod = (trigger?.params as Record<string, unknown>)?.method as string ?? method;
        const triggerPath = (trigger?.params as Record<string, unknown>)?.routePath as string ?? initialPath;
        const targetUrl = `http://localhost:3003${triggerPath}`;

        const fetchOpts: RequestInit = { method: triggerMethod, headers: parsedHeaders };
        if (["POST", "PUT", "PATCH"].includes(triggerMethod) && body.trim()) {
          fetchOpts.body = body;
        }

        const res = await fetch(targetUrl, fetchOpts);
        const duration = Math.round(performance.now() - start);
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => { resHeaders[k] = v; });

        const contentType = res.headers.get("content-type") || "";
        const resBody = contentType.includes("application/json")
          ? JSON.stringify(await res.json(), null, 2)
          : await res.text();

        const resp: SandboxResponse = { status: res.status, statusText: res.statusText, headers: resHeaders, body: resBody, duration };
        setResponse(resp);
        setUrl(targetUrl);
        setMethod(triggerMethod);
        addToHistory(triggerMethod, targetUrl, resp, null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        addToHistory(method, url, null, msg);
      } finally {
        setLoading(false);
      }
    } else {
      setError(`Compile failed: ${result}`);
    }
  }, [exportIR, compile, headers, body, method, url, initialPath]);

  const handleSend = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const start = performance.now();

    try {
      let parsedHeaders: Record<string, string> = {};
      try {
        parsedHeaders = JSON.parse(headers);
      } catch {
        setError("Invalid Headers JSON format");
        setLoading(false);
        return;
      }

      const fetchOpts: RequestInit = { method, headers: parsedHeaders };
      if (["POST", "PUT", "PATCH"].includes(method) && body.trim()) {
        fetchOpts.body = body;
      }

      const res = await fetch(url, fetchOpts);
      const duration = Math.round(performance.now() - start);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      let resBody: string;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        resBody = JSON.stringify(json, null, 2);
      } else {
        resBody = await res.text();
      }

      const resp: SandboxResponse = { status: res.status, statusText: res.statusText, headers: resHeaders, body: resBody, duration };
      setResponse(resp);
      addToHistory(method, url, resp, null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addToHistory(method, url, null, msg);
    } finally {
      setLoading(false);
    }
  }, [method, url, headers, body]);

  const addToHistory = (m: string, u: string, resp: SandboxResponse | null, err: string | null) => {
    setHistory((prev) => [
      { id: `h-${Date.now()}`, timestamp: new Date().toISOString(), method: m, url: u, response: resp, error: err },
      ...prev,
    ].slice(0, 20));
  };

  // Generate cURL command from current request
  const handleCopyCurl = useCallback(() => {
    let parsedHeaders: Record<string, string> = {};
    try { parsedHeaders = JSON.parse(headers); } catch { /* skip */ }

    let curl = `curl -X ${method}`;
    for (const [k, v] of Object.entries(parsedHeaders)) {
      curl += ` \\\n  -H '${k}: ${v}'`;
    }
    if (["POST", "PUT", "PATCH"].includes(method) && body.trim()) {
      curl += ` \\\n  -d '${body.replace(/'/g, "\\'")}'`;
    }
    curl += ` \\\n  '${url}'`;

    navigator.clipboard.writeText(curl);
  }, [method, url, headers, body]);

  const statusVariant = !response
    ? "secondary"
    : response.status < 300
      ? "default"
      : response.status < 400
        ? "secondary"
        : "destructive";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[820px] max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <DialogTitle>🧪 API Test Sandbox</DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={activeTab === "request" ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() => setActiveTab("request")}
              >
                Request
              </Button>
              <Button
                variant={activeTab === "history" ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() => setActiveTab("history")}
              >
                History ({history.length})
              </Button>
            </div>
          </div>
        </DialogHeader>

        {activeTab === "request" ? (
          <>
            {/* Request */}
            <div className="px-5 pb-4 space-y-3 border-b border-border">
              <div className="flex gap-2">
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-[110px] font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:3003/api/..."
                  className="flex-1 font-mono text-sm"
                />

                <Button onClick={handleSend} disabled={loading} size="default">
                  {loading ? "⏳" : "▶ Send"}
                </Button>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 text-emerald-400 border-emerald-400/30 hover:bg-emerald-500/10"
                      onClick={handleCompileAndTest}
                      disabled={loading}
                    >
                      🚀 Compile & Test
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Compile the flow, sync endpoint, and auto-send a test request</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleCopyCurl}>
                      📋 cURL
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy request as cURL command</TooltipContent>
                </Tooltip>
              </div>

              <Tabs defaultValue="body" className="w-full">
                <TabsList className="h-8">
                  <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
                  <TabsTrigger value="headers" className="text-xs">Headers</TabsTrigger>
                </TabsList>
                <TabsContent value="body">
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder='{ "key": "value" }'
                    rows={4}
                    className="font-mono text-xs resize-y"
                  />
                </TabsContent>
                <TabsContent value="headers">
                  <Textarea
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                    rows={4}
                    className="font-mono text-xs resize-y"
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Response */}
            <ScrollArea className="flex-1 px-5 py-4 max-h-[50vh]">
              {error && (
                <div className="text-destructive text-xs font-mono bg-destructive/10 px-3 py-2 rounded-md mb-3">
                  ❌ {error}
                </div>
              )}

              {response && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant} className="font-mono">
                      {response.status} {response.statusText}
                    </Badge>
                    <span className="text-muted-foreground text-xs">⏱ {response.duration}ms</span>
                    <span className="text-muted-foreground text-xs">📦 {new Blob([response.body]).size} bytes</span>
                  </div>

                  <pre className="bg-secondary text-emerald-400 text-xs font-mono rounded-lg p-3 overflow-auto max-h-[300px] whitespace-pre-wrap border border-border">
                    {response.body}
                  </pre>

                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                      Response Headers ({Object.keys(response.headers).length})
                    </summary>
                    <pre className="bg-secondary text-muted-foreground font-mono rounded-lg p-2 mt-1 overflow-auto max-h-[150px] border border-border">
                      {JSON.stringify(response.headers, null, 2)}
                    </pre>
                  </details>
                </div>
              )}

              {!response && !error && !loading && (
                <p className="text-muted-foreground text-xs text-center py-8">
                  Click Send to make a request, or use Compile & Test to auto-compile and test
                </p>
              )}
            </ScrollArea>
          </>
        ) : (
          /* History Tab */
          <ScrollArea className="flex-1 px-5 py-4 max-h-[60vh]">
            {history.length > 0 ? (
              <div className="flex flex-col gap-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setMethod(item.method);
                      setUrl(item.url);
                      if (item.response) setResponse(item.response);
                      if (item.error) setError(item.error);
                      setActiveTab("request");
                    }}
                  >
                    <Badge variant="outline" className="font-mono text-[10px] min-w-[50px] justify-center">
                      {item.method}
                    </Badge>
                    <span className="text-xs text-foreground font-mono truncate flex-1">{item.url}</span>
                    {item.response && (
                      <Badge
                        variant={item.response.status < 300 ? "default" : "destructive"}
                        className="text-[9px]"
                      >
                        {item.response.status}
                      </Badge>
                    )}
                    {item.error && (
                      <Badge variant="destructive" className="text-[9px]">ERR</Badge>
                    )}
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs text-center py-8">
                No request history yet
              </p>
            )}
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
