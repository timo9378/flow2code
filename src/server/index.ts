#!/usr/bin/env node

/**
 * Flow2Code Standalone Dev Server
 *
 * 零依賴 (僅 Node.js 內建 http/fs/path)
 * - 提供 3 個 API 端點：/api/compile, /api/generate, /api/import-openapi
 * - 靜態資源服務 (Next.js export output at `out/`)
 * - CORS 支援 (dev 模式下 Allow-Origin: *)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { handleCompile, handleGenerate, handleImportOpenAPI } from "./handlers.js";

// ── Path Management ──
// __dirname → package-internal assets (out/ 靜態檔案)
// process.cwd() → 使用者專案目錄 (user project)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 找 out/ 目錄：依序檢查候選路徑，回傳第一個存在的
 */
function resolveStaticDir(): string {
  const candidates = [
    join(__dirname, "..", "out"),       // dist/server.js → ../out (npm 套件結構)
    join(__dirname, "out"),             // dist/out/
    join(__dirname, "..", "..", "out"), // src/server/index.ts → ../../out (dev)
    join(process.cwd(), "out"),        // fallback: cwd/out
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) {
      return dir;
    }
  }

  // 都不存在就用最常見的路徑（啟動時會印警告）
  return candidates[0];
}

// ── MIME Types ──
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

// ── Helpers ──

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  return JSON.parse(raw);
}

// ── Static File Server ──

async function serveStatic(staticDir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  // Map / → /index.html
  let filePath = join(staticDir, pathname === "/" ? "index.html" : pathname);

  // 如果路徑不含副檔名，嘗試 .html (for Next.js export pages)
  if (!extname(filePath)) {
    filePath += ".html";
  }

  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await readFile(filePath);

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ── Route Handler ──

async function handleRequest(req: IncomingMessage, res: ServerResponse, staticDir: string, projectRoot: string) {
  setCors(res);

  const { method } = req;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  // Preflight
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API Routes ──
  if (pathname.startsWith("/api/")) {
    if (method !== "POST") {
      sendJson(res, 405, { error: "Method Not Allowed" });
      return;
    }

    let body: any;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (pathname === "/api/compile") {
      const result = handleCompile(body, projectRoot);
      sendJson(res, result.status, result.body);
      return;
    }

    if (pathname === "/api/generate") {
      const result = await handleGenerate(body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (pathname === "/api/import-openapi") {
      const result = handleImportOpenAPI(body);
      sendJson(res, result.status, result.body);
      return;
    }

    sendJson(res, 404, { error: `Unknown API route: ${pathname}` });
    return;
  }

  // ── Static Files ──
  const served = await serveStatic(staticDir, pathname, res);
  if (served) return;

  // SPA fallback → index.html
  const indexPath = join(staticDir, "index.html");
  try {
    const content = await readFile(indexPath, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found — UI 尚未建置，請先執行 pnpm build:ui");
  }
}

// ── Server Bootstrap ──

export interface ServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  /** 使用者專案根目錄 (預設 process.cwd()) */
  projectRoot?: string;
  /** 啟動後的 callback */
  onReady?: (url: string) => void;
}

export function startServer(options: ServerOptions = {}) {
  const port = options.port ?? (Number(process.env.PORT) || 3100);
  const host = options.host ?? "0.0.0.0";
  const staticDir = options.staticDir ?? resolveStaticDir();
  const projectRoot = options.projectRoot ?? process.cwd();

  const server = createServer((req, res) => {
    handleRequest(req, res, staticDir, projectRoot).catch((err) => {
      console.error("[flow2code] Internal error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    });
  });

  server.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    if (options.onReady) {
      options.onReady(url);
    } else {
      console.log(`\n  🚀 Flow2Code Dev Server`);
      console.log(`  ├─ Local:   ${url}`);
      console.log(`  ├─ API:     ${url}/api/compile`);
      console.log(`  ├─ Static:  ${staticDir}`);
      console.log(`  └─ Project: ${projectRoot}\n`);
    }
  });

  return server;
}

// 如果直接執行此檔案 (非透過 CLI import)
// node dist/server.js → argv[1] 就是這個檔案本身
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
