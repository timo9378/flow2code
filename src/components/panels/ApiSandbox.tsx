"use client";

/**
 * API 測試沙盒元件
 *
 * 在編譯完成後可以直接在 UI 中測試生成的 API 端點。
 * 支援 GET/POST/PUT/PATCH/DELETE，自定義 Headers 和 Body。
 */

import { useState, useCallback } from "react";

interface SandboxProps {
  /** 初始 HTTP 方法 */
  initialMethod?: string;
  /** 初始路由路徑（如 /api/hello） */
  initialPath?: string;
  /** 關閉回呼 */
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
  const [headers, setHeaders] = useState(
    '{\n  "Content-Type": "application/json"\n}'
  );
  const [body, setBody] = useState("{}");
  const [response, setResponse] = useState<SandboxResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"body" | "headers">("body");

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
        setError("Headers JSON 格式錯誤");
        setLoading(false);
        return;
      }

      const fetchOpts: RequestInit = {
        method,
        headers: parsedHeaders,
      };

      if (["POST", "PUT", "PATCH"].includes(method) && body.trim()) {
        fetchOpts.body = body;
      }

      const res = await fetch(url, fetchOpts);
      const duration = Math.round(performance.now() - start);

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });

      let resBody: string;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        resBody = JSON.stringify(json, null, 2);
      } else {
        resBody = await res.text();
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: resBody,
        duration,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [method, url, headers, body]);

  const statusColor =
    !response
      ? "text-gray-400"
      : response.status < 300
        ? "text-green-400"
        : response.status < 400
          ? "text-yellow-400"
          : "text-red-400";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-[800px] max-h-[85vh] flex flex-col border border-gray-700">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="text-white text-sm font-semibold">
            🧪 API 測試沙盒
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* ── Request ── */}
        <div className="p-4 space-y-3 border-b border-gray-700">
          {/* Method + URL */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none min-w-[100px]"
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3003/api/..."
              className="flex-1 bg-gray-800 text-white text-sm rounded px-3 py-1.5 border border-gray-700 focus:border-blue-500 outline-none font-mono"
            />
            <button
              onClick={handleSend}
              disabled={loading}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors cursor-pointer font-semibold"
            >
              {loading ? "⏳" : "▶ Send"}
            </button>
          </div>

          {/* Tabs: Body / Headers */}
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("body")}
              className={`px-3 py-1 text-xs rounded cursor-pointer ${
                activeTab === "body"
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              Body
            </button>
            <button
              onClick={() => setActiveTab("headers")}
              className={`px-3 py-1 text-xs rounded cursor-pointer ${
                activeTab === "headers"
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              Headers
            </button>
          </div>

          {/* Body / Headers textareas */}
          {activeTab === "body" ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{ "key": "value" }'
              rows={4}
              className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 outline-none resize-y font-mono"
            />
          ) : (
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 outline-none resize-y font-mono"
            />
          )}
        </div>

        {/* ── Response ── */}
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {error && (
            <div className="text-red-400 text-xs font-mono bg-red-900/20 px-3 py-2 rounded">
              ❌ {error}
            </div>
          )}

          {response && (
            <>
              {/* Status bar */}
              <div className="flex items-center gap-3 text-xs">
                <span className={`font-bold ${statusColor}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-gray-500">
                  ⏱ {response.duration}ms
                </span>
                <span className="text-gray-500">
                  📦 {new Blob([response.body]).size} bytes
                </span>
              </div>

              {/* Response body */}
              <pre className="bg-gray-800 text-green-400 text-xs font-mono rounded-lg p-3 overflow-auto max-h-[300px] whitespace-pre-wrap border border-gray-700">
                {response.body}
              </pre>

              {/* Response headers (collapsible) */}
              <details className="text-xs">
                <summary className="text-gray-500 cursor-pointer hover:text-white">
                  Response Headers ({Object.keys(response.headers).length})
                </summary>
                <pre className="bg-gray-800 text-gray-400 font-mono rounded-lg p-2 mt-1 overflow-auto max-h-[150px]">
                  {JSON.stringify(response.headers, null, 2)}
                </pre>
              </details>
            </>
          )}

          {!response && !error && !loading && (
            <div className="text-gray-600 text-xs text-center py-8">
              點擊 Send 發送請求
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
