#!/usr/bin/env node

/**
 * Flow2Code Standalone Dev Server
 *
 * Zero dependencies (only Node.js built-in http/fs/path)
 * - Provides 3 API endpoints: /api/compile, /api/generate, /api/import-openapi
 * - Static asset serving (Next.js export output at `out/`)
 * - CORS support (Allow-Origin: * in dev mode)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname, resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { handleCompile, handleGenerate, handleImportOpenAPI, handleDecompile } from "./handlers.js";
import { logger } from "../lib/logger.js";

// Re-export handlers for programmatic use
export { handleCompile, handleGenerate, handleImportOpenAPI, handleDecompile } from "./handlers.js";
export type { ApiResponse, CompileRequest, DecompileRequest } from "./handlers.js";

// ── Path Management ──
// __dirname → package-internal assets (out/ static files)
// process.cwd() → user project directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Locate the out/ directory: check candidate paths in order, return the first that exists
 */
function resolveStaticDir(): string {
  const candidates = [
    join(__dirname, "..", "out"),       // dist/server.js → ../out (npm package structure)
    join(__dirname, "out"),             // dist/out/
    join(__dirname, "..", "..", "out"), // src/server/index.ts → ../../out (dev)
    join(process.cwd(), "out"),        // fallback: cwd/out
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) {
      return dir;
    }
  }

  // None found — use the most common path (a warning will be printed on startup)
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

const isDev = process.env.NODE_ENV !== "production";

function setCors(res: ServerResponse) {
  const origin = isDev ? "*" : (process.env.CORS_ORIGIN || "");
  if (!origin) return; // In production, no CORS headers = same-origin only
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Security Headers — Content-Security-Policy + common defense headers.
 * Dev server allows 'unsafe-inline' (required by React/Next dev).
 */
function setSecurityHeaders(res: ServerResponse) {
  // CSP: restrict loading sources to prevent XSS
  // Production tightens policy; Dev allows inline (required by React/Next HMR)
  const csp = isDev
    ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' *",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; ")
    : [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error(`Body too large (max ${MAX_BODY_SIZE / 1024 / 1024} MB)`));
        return;
      }
      chunks.push(chunk);
    });
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
  // Decode URI components (handles spaces, CJK chars, etc.)
  const decodedPath = decodeURIComponent(pathname);

  // Map / → /index.html
  let filePath = join(staticDir, decodedPath === "/" ? "index.html" : decodedPath);

  // 【Security】Prevent path traversal attacks (e.g. ../../etc/passwd, %2e%2e%2f)
  const resolvedPath = resolve(filePath);
  const resolvedStaticDir = resolve(staticDir);
  if (!resolvedPath.startsWith(resolvedStaticDir + (resolvedStaticDir.endsWith('/') || resolvedStaticDir.endsWith('\\') ? '' : (process.platform === 'win32' ? '\\' : '/')))) {
    return false;
  }

  // If path has no extension, try .html (for Next.js export pages)
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
  setSecurityHeaders(res);

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

    let body: unknown;
    try {
      // Validate Content-Type
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        sendJson(res, 415, { error: "Content-Type must be application/json" });
        return;
      }
      body = await parseJsonBody(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON body";
      sendJson(res, 400, { error: msg });
      return;
    }

    if (pathname === "/api/compile") {
      const result = handleCompile(body as import("./handlers.js").CompileRequest, projectRoot);
      sendJson(res, result.status, result.body);
      return;
    }

    if (pathname === "/api/generate") {
      const result = await handleGenerate(body as { prompt?: string });
      sendJson(res, result.status, result.body);
      return;
    }

    if (pathname === "/api/import-openapi") {
      const result = handleImportOpenAPI(body as { spec?: unknown; filter?: { tags?: string[]; paths?: string[] } });
      sendJson(res, result.status, result.body);
      return;
    }

    if (pathname === "/api/decompile") {
      const result = handleDecompile(body as import("./handlers.js").DecompileRequest);
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
    res.end("404 Not Found — UI static files not found. If you installed via npm, please update to the latest version.");
  }
}

// ── Server Bootstrap ──

export interface ServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  /** User project root directory (defaults to process.cwd()) */
  projectRoot?: string;
  /** Callback after server starts */
  onReady?: (url: string) => void;
}

export function startServer(options: ServerOptions = {}) {
  const port = options.port ?? (Number(process.env.PORT) || 3100);
  const host = options.host ?? "0.0.0.0";
  const staticDir = options.staticDir ?? resolveStaticDir();
  const projectRoot = options.projectRoot ?? process.cwd();

  const server = createServer((req, res) => {
    handleRequest(req, res, staticDir, projectRoot).catch((err) => {
      logger.error("Internal error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });
  });

  // Prevent Slowloris-style DoS: reject requests that take too long to send headers/body
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  const hasUI = existsSync(join(staticDir, "index.html"));

  server.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    if (options.onReady) {
      options.onReady(url);
    } else {
      logger.blank();
      logger.info("Flow2Code Dev Server");
      logger.kv("Local:", url);
      logger.kv("API:", `${url}/api/compile`);
      logger.kv("Static:", staticDir);
      logger.kvLast("Project:", projectRoot);
      if (!hasUI) {
        logger.blank();
        logger.warn("UI files not found (out/index.html missing).");
        logger.raw("     The API endpoints still work, but the visual editor won't load.");
        logger.raw('     To fix: run "pnpm build:ui" in the flow2code source directory,');
        logger.raw("     or reinstall from npm: npm i @timo9378/flow2code@latest");
      }
      logger.blank();
    }
  });

  return server;
}

// Standalone dev server boot logic has been removed; now fully invoked via cli/index.ts calling startServer()

