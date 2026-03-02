"use client";

/**
 * API Test Sandbox Component — shadcn/ui version
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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

      setResponse({ status: res.status, statusText: res.statusText, headers: resHeaders, body: resBody, duration });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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
          <DialogTitle>🧪 API Test Sandbox</DialogTitle>
        </DialogHeader>

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
              Click Send to make a request
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
